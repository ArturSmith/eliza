import { beforeAll, afterAll, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';

const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_phone_scanner_${Date.now()}`;
const admin = new Database();
let db: Database, app: Awaited<ReturnType<typeof createApp>>, url: string;
class Client {
  cookies = new Map<string, string>();
  async request(
    path: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
    extra: Record<string, string> = {},
  ) {
    const response = await fetch(url + '/api' + path, {
      method,
      headers: {
        ...extra,
        Origin: 'http://localhost:5173',
        'X-Eliza-Request': '1',
        'Content-Type': 'application/json',
        Cookie: [...this.cookies].map(([key, value]) => key + '=' + value).join('; '),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [key, value] = cookie.split(';')[0].split('=');
      if (value) this.cookies.set(key, value);
    }
    return { status: response.status, body: await response.json() };
  }
}
beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE ${name}`);
  const parsed = new URL(original);
  parsed.pathname = '/' + name;
  process.env.DATABASE_URL = parsed.toString();
  execFileSync(process.execPath, ['apps/api/dist/migrate.js'], { env: process.env });
  db = new Database();
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.onModuleDestroy();
  process.env.DATABASE_URL = original;
  await admin.pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.onModuleDestroy();
});

const owner = new Client(),
  phone = new Client();
const account = {
  storeName: 'Scanner shop',
  ownerName: 'Owner',
  email: 'scanner@local.test',
  password: 'owner-password-12345',
  currency: 'NOK',
  timezone: 'Europe/Oslo',
};
let ownerId: string, storeId: string, roleId: string;
const mobile = (path: string, credential: string, b: unknown = {}) =>
  phone.request('/scanner-phone/' + path, b, 'POST', { 'X-Scanner-Token': credential });
const sync = (id: string, targetId: string | null, other: any = {}) =>
  owner.request('/scanner-links/' + id + '/sync', {
    targetId,
    ready: !!targetId,
    label: 'Product form',
    ...other,
  });
async function connect() {
  const paired = await owner.request('/scanner-links', { tabId: crypto.randomUUID() });
  expect(paired.status, JSON.stringify(paired.body)).toBe(201);
  const claim = await phone.request('/scanner-phone/claim', {
    pairingToken: paired.body.pairingToken,
  });
  expect(claim.status, JSON.stringify(claim.body)).toBe(201);
  return { ...paired.body, credential: claim.body.credential };
}
beforeAll(async () => {
  expect((await owner.request('/auth/setup', account)).status).toBe(201);
  const session = (await owner.request('/auth/session')).body;
  ownerId = session.user.id;
  storeId = session.store.id;
  roleId = (await db.pool.query('SELECT role_id FROM employees WHERE id=$1', [ownerId])).rows[0]
    .role_id;
});
it('pairs once with hashed, expiring credentials and gives the phone no management access', async () => {
  const link = await connect();
  expect(link.credential).toMatch(/^[a-f0-9]{64}$/);
  const row = (await db.pool.query('SELECT * FROM scanner_links WHERE id=$1', [link.id])).rows[0];
  expect(row.pairing_token_hash).toBeNull();
  expect(row.phone_token_hash).not.toBe(link.credential);
  expect(row.phone_token_hash).toHaveLength(64);
  expect(
    (await phone.request('/scanner-phone/claim', { pairingToken: link.pairingToken })).status,
  ).toBe(410);
  expect((await mobile('status', link.credential)).body).toMatchObject({
    shopName: 'Scanner shop',
    ready: false,
    targetId: null,
  });
  expect(
    (await phone.request('/products', undefined, 'GET', { 'X-Scanner-Token': link.credential }))
      .status,
  ).toBe(401);
  expect(
    (
      await phone.request('/scanner-links', { tabId: crypto.randomUUID() }, 'POST', {
        'X-Scanner-Token': link.credential,
      })
    ).status,
  ).toBe(401);
  expect((await mobile('status', '0'.repeat(64))).status).toBe(410);
});
it('delivers a barcode once, acknowledges it and retries idempotently without creating products', async () => {
  const link = await connect(),
    targetId = crypto.randomUUID(),
    id = crypto.randomUUID();
  await sync(link.id, targetId);
  const b = { id, targetId, barcode: '3017620422003' };
  const [one, two] = await Promise.all([
    mobile('scans', link.credential, b),
    mobile('scans', link.credential, b),
  ]);
  expect(one.status).toBe(201);
  expect(two.body).toEqual(one.body);
  expect((await sync(link.id, targetId)).body.event).toMatchObject(b);
  expect((await mobile('scans', link.credential, { ...b, barcode: '12345678' })).status).toBe(409);
  expect((await mobile('scans', link.credential, { ...b, id: crypto.randomUUID() })).status).toBe(
    409,
  );
  expect((await sync(link.id, targetId, { ackId: id })).body.event).toBeNull();
  expect((await mobile('status', link.credential)).body.lastScan).toMatchObject({
    ...b,
    status: 'delivered',
  });
  expect((await mobile('scans', link.credential, b)).body.status).toBe('delivered');
  expect(
    (
      await db.pool.query('SELECT count(*)::int AS n FROM scanner_link_scans WHERE link_id=$1', [
        link.id,
      ])
    ).rows[0].n,
  ).toBe(1);
  expect(
    (await db.pool.query('SELECT count(*)::int AS n FROM products WHERE store_id=$1', [storeId]))
      .rows[0].n,
  ).toBe(0);
});
it('keeps the phone paired between products while rejecting late scans for the old form and paused forms', async () => {
  const link = await connect(),
    first = crypto.randomUUID(),
    second = crypto.randomUUID();
  await sync(link.id, first);
  const scan = { id: crypto.randomUUID(), targetId: first, barcode: '12345678' };
  expect((await mobile('scans', link.credential, scan)).status).toBe(201);
  expect((await sync(link.id, second)).body.event).toBeNull();
  expect((await mobile('status', link.credential)).body.lastScan.status).toBe('cancelled');
  expect(
    (await mobile('scans', link.credential, { ...scan, id: crypto.randomUUID() })).status,
  ).toBe(409);
  await sync(link.id, second, { ready: false });
  expect(
    (await mobile('scans', link.credential, { ...scan, id: crypto.randomUUID(), targetId: second }))
      .status,
  ).toBe(409);
  await sync(link.id, second);
  await db.pool.query(
    "UPDATE scanner_link_scans SET created_at=now()-interval '2 seconds' WHERE link_id=$1",
    [link.id],
  );
  const next = { id: crypto.randomUUID(), targetId: second, barcode: '5901234123457' };
  expect((await mobile('scans', link.credential, next)).status).toBe(201);
  expect((await sync(link.id, second)).body.event).toMatchObject(next);
});
it('isolates sessions, stores and phones and rejects malformed input', async () => {
  const link = await connect(),
    other = new Client();
  process.env.ALLOW_REGISTRATION = 'true';
  try {
    expect(
      (
        await other.request('/auth/register', {
          ...account,
          email: 'other-scanner@local.test',
          storeName: 'Other shop',
        })
      ).status,
    ).toBe(201);
  } finally {
    delete process.env.ALLOW_REGISTRATION;
  }
  expect(
    (
      await other.request('/scanner-links/' + link.id + '/sync', {
        targetId: null,
        ready: false,
        label: '',
      })
    ).status,
  ).toBe(410);
  expect((await other.request('/scanner-links/' + link.id + '/disconnect', {})).status).toBe(410);
  const another = await connect(),
    targetId = crypto.randomUUID();
  await sync(link.id, targetId);
  const body = { id: crypto.randomUUID(), targetId, barcode: '12345678' };
  expect((await mobile('scans', another.credential, body)).status).toBe(409);
  expect(
    (await mobile('scans', link.credential, { ...body, barcode: 'bad\u0000code' })).status,
  ).toBe(400);
  expect(
    (await mobile('scans', link.credential, { ...body, barcode: 'x'.repeat(4097) })).status,
  ).toBe(400);
  expect(
    (await mobile('scans', link.credential, { ...body, productId: crypto.randomUUID() })).status,
  ).toBe(400);
  const secondLogin = new Client();
  await secondLogin.request('/auth/login', { email: account.email, password: account.password });
  expect(
    (
      await secondLogin.request('/scanner-links/' + link.id + '/sync', {
        targetId: null,
        ready: false,
        label: '',
      })
    ).status,
  ).toBe(410);
});
it('expires old QR codes, disconnects immediately and replaces only explicit connection credentials', async () => {
  const tabId = crypto.randomUUID(),
    one = (await owner.request('/scanner-links', { tabId })).body;
  const two = (await owner.request('/scanner-links', { tabId })).body;
  expect(two.id).toBe(one.id);
  expect(
    (await phone.request('/scanner-phone/claim', { pairingToken: one.pairingToken })).status,
  ).toBe(410);
  await db.pool.query(
    "UPDATE scanner_links SET pair_expires_at=now()-interval '1 second' WHERE id=$1",
    [two.id],
  );
  expect(
    (await phone.request('/scanner-phone/claim', { pairingToken: two.pairingToken })).status,
  ).toBe(410);
  const link = await connect();
  expect((await owner.request('/scanner-links/' + link.id + '/disconnect', {})).status).toBe(201);
  expect((await mobile('status', link.credential)).status).toBe(410);
  expect(
    (
      await mobile('scans', link.credential, {
        id: crypto.randomUUID(),
        targetId: crypto.randomUUID(),
        barcode: '12345678',
      })
    ).status,
  ).toBe(410);
});
it('pauses when the desktop heartbeat expires and rejects revoked employee permissions', async () => {
  const link = await connect(),
    targetId = crypto.randomUUID();
  await sync(link.id, targetId);
  await db.pool.query(
    "UPDATE scanner_links SET ready_until=now()-interval '1 second' WHERE id=$1",
    [link.id],
  );
  expect((await mobile('status', link.credential)).body.ready).toBe(false);
  expect(
    (
      await mobile('scans', link.credential, {
        id: crypto.randomUUID(),
        targetId,
        barcode: '12345678',
      })
    ).status,
  ).toBe(409);
  const originalPermissions = (
    await db.pool.query('SELECT permissions FROM roles WHERE id=$1', [roleId])
  ).rows[0].permissions;
  await db.pool.query('UPDATE roles SET permissions=$2 WHERE id=$1', [
    roleId,
    JSON.stringify(originalPermissions.filter((p: string) => p !== 'catalog.write')),
  ]);
  expect((await mobile('status', link.credential)).status).toBe(410);
  expect((await owner.request('/scanner-links', { tabId: crypto.randomUUID() })).status).toBe(403);
  await db.pool.query('UPDATE roles SET permissions=$2 WHERE id=$1', [
    roleId,
    JSON.stringify(originalPermissions),
  ]);
});
it('transports multiline QR text and cancels rejected values without acknowledging delivery', async () => {
  const link = await connect(),
    targetId = crypto.randomUUID();
  await sync(link.id, targetId, { label: 'Description' });
  const body = {
    id: crypto.randomUUID(),
    targetId,
    barcode: 'QR description\n' + 'x'.repeat(1500),
  };
  expect((await mobile('scans', link.credential, body)).status).toBe(201);
  expect((await sync(link.id, targetId)).body.event).toMatchObject(body);
  expect((await sync(link.id, targetId, { cancelId: body.id })).body.event).toBeNull();
  expect((await mobile('status', link.credential)).body.lastScan.status).toBe('cancelled');
  await sync(link.id, targetId, { ackId: body.id });
  expect((await mobile('status', link.credential)).body.lastScan.status).toBe('cancelled');
});

it('ends all linked phone access when the owning management login is closed', async () => {
  const link = await connect();
  expect((await owner.request('/auth/logout', {})).status).toBe(200);
  expect((await mobile('status', link.credential)).status).toBe(410);
  expect(
    (await db.pool.query('SELECT id FROM scanner_links WHERE id=$1', [link.id])).rowCount,
  ).toBe(0);
});
