import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
import { hash } from '../apps/api/dist/security.js';
const admin = new Database();
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_onboarding_${Date.now()}`;
let db: Database,
  app: Awaited<ReturnType<typeof createApp>>,
  url: string,
  ownerCookie: string,
  ownerId: string,
  storeId: string;
async function request(path: string, body?: unknown, cookie = ownerCookie) {
  const response = await fetch(url + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: 'http://localhost:5173',
      'X-Eliza-Request': '1',
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    body: await response.json(),
    cookie: response.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; '),
  };
}
beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE ${name}`);
  const parsed = new URL(original);
  parsed.pathname = `/${name}`;
  process.env.DATABASE_URL = parsed.toString();
  execFileSync(process.execPath, ['apps/api/dist/migrate.js'], { env: process.env });
  db = new Database();
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
  const setup = await request(
    '/auth/setup',
    {
      storeName: 'Guides',
      ownerName: 'Owner',
      email: 'guides@example.test',
      password: 'test-password-12345',
      currency: 'NOK',
      timezone: 'Europe/Oslo',
    },
    '',
  );
  expect(setup.status).toBe(201);
  ownerCookie = setup.cookie;
  const session = (await request('/auth/session')).body;
  ownerId = session.user.id;
  storeId = session.store.id;
});
afterAll(async () => {
  await app?.close();
  await db?.onModuleDestroy();
  process.env.DATABASE_URL = original;
  await admin.pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.onModuleDestroy();
});
describe.sequential('per-employee walkthrough progress', () => {
  it('requires authentication in every employee workspace', async () => {
    for (const path of ['/auth/onboarding', '/pos/onboarding', '/price-tags/onboarding']) {
      expect((await request(path, undefined, '')).status).toBe(401);
      expect(
        (await request(path, { pageId: 'products', version: 1, status: 'completed' }, '')).status,
      ).toBe(401);
    }
  });
  it('validates and idempotently saves versioned completion and skips', async () => {
    expect((await request('/auth/onboarding')).body).toEqual([]);
    for (const invalid of [
      { pageId: 'unknown', version: 1, status: 'completed' },
      { pageId: 'products', version: 0, status: 'completed' },
      { pageId: 'products', version: 1, status: 'anything' },
    ])
      expect((await request('/auth/onboarding', invalid)).status).toBe(400);
    const progress = { pageId: 'products', version: 1, status: 'completed' };
    for (const result of await Promise.all(
      Array.from({ length: 4 }, () => request('/auth/onboarding', progress)),
    ))
      expect(result.status).toBe(201);
    expect((await request('/auth/onboarding')).body).toEqual([progress]);
    expect(
      (await db.pool.query('SELECT count(*)::int AS n FROM onboarding_progress')).rows[0].n,
    ).toBe(1);
    await request('/auth/onboarding', { ...progress, status: 'skipped' });
    await request('/auth/onboarding', { ...progress, version: 2 });
    expect((await request('/auth/onboarding')).body).toHaveLength(2);
  });
  it('keeps employee and store progress isolated and ignores claimed actor IDs', async () => {
    const other = (
      await db.pool.query(
        `INSERT INTO employees(store_id,role_id,name,email,password_hash)
      SELECT store_id,role_id,'Other','other-guides@example.test',password_hash FROM employees WHERE id=$1 RETURNING id`,
        [ownerId],
      )
    ).rows[0];
    const login = await request(
      '/auth/login',
      { email: 'other-guides@example.test', password: 'test-password-12345' },
      '',
    );
    expect(login.status).toBe(200);
    expect((await request('/auth/onboarding', undefined, login.cookie)).body).toEqual([]);
    await request(
      '/auth/onboarding',
      {
        pageId: 'inventory',
        version: 1,
        status: 'completed',
        employeeId: ownerId,
        storeId: '00000000-0000-0000-0000-000000000000',
      },
      login.cookie,
    );
    expect(
      (
        await db.pool.query(
          "SELECT employee_id,store_id FROM onboarding_progress WHERE page_id='inventory'",
        )
      ).rows[0],
    ).toEqual({ employee_id: other.id, store_id: storeId });
    const secondStore = (
      await db.pool.query(
        "INSERT INTO stores(organization_id,name,currency,timezone) SELECT organization_id,'Other store',currency,timezone FROM stores WHERE id=$1 RETURNING id",
        [storeId],
      )
    ).rows[0].id;
    const role = (
      await db.pool.query(
        "INSERT INTO roles(store_id,name,permissions) SELECT $1,'Owner',permissions FROM roles WHERE store_id=$2 AND name='Owner' RETURNING id",
        [secondStore, storeId],
      )
    ).rows[0].id;
    await db.pool.query(
      "INSERT INTO employees(store_id,role_id,name,email,password_hash) SELECT $1,$2,'Other store owner','other-store@example.test',password_hash FROM employees WHERE id=$3",
      [secondStore, role, ownerId],
    );
    const secondLogin = await request(
      '/auth/login',
      { email: 'other-store@example.test', password: 'test-password-12345' },
      '',
    );
    expect(secondLogin.status).toBe(200);
    expect((await request('/auth/onboarding', undefined, secondLogin.cookie)).body).toEqual([]);
  });
  it('shares progress across authenticated checkout and Price Tags devices for the same employee', async () => {
    for (const mode of ['pos', 'price_tags']) {
      const token = crypto.randomUUID(),
        session = crypto.randomUUID();
      const device = (
        await db.pool.query(
          'INSERT INTO devices(store_id,name,type,token_hash) VALUES($1,$2,$3,$4) RETURNING id',
          [storeId, mode, mode, hash(token)],
        )
      ).rows[0].id;
      const table = mode === 'pos' ? 'pos_sessions' : 'price_tag_sessions';
      await db.pool.query(
        `INSERT INTO ${table}(token_hash,device_id,employee_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')`,
        [hash(session), device, ownerId],
      );
      const cookie = `eliza_register=${token}; ${mode === 'pos' ? 'eliza_pos_session' : 'eliza_price_tags_session'}=${session}`;
      const path = mode === 'pos' ? '/pos/onboarding' : '/price-tags/onboarding';
      expect((await request(path, undefined, cookie)).body).toEqual(
        (await request('/auth/onboarding')).body,
      );
      const progress = {
        pageId: mode === 'pos' ? 'pos' : 'price-tags',
        version: 1,
        status: 'completed',
      };
      expect((await request(path, progress, cookie)).status).toBe(201);
      expect((await request('/auth/onboarding')).body).toContainEqual(progress);
      await db.pool.query('UPDATE devices SET active=false WHERE id=$1', [device]);
      expect((await request(path, undefined, cookie)).status).toBe(403);
    }
  });
});
