import { beforeAll, afterAll, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';

const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_product_options_${Date.now()}`;
const admin = new Database();
let db: Database, app: Awaited<ReturnType<typeof createApp>>, url: string;
class Client {
  cookies = new Map<string, string>();
  async request(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(url + '/api' + path, {
      method,
      headers: {
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

const owner = new Client();
let storeId: string;
beforeAll(async () => {
  expect(
    (
      await owner.request('/auth/setup', {
        storeName: 'Product options',
        ownerName: 'Owner',
        email: 'options@local.test',
        password: 'owner-password-12345',
        currency: 'NOK',
        timezone: 'Europe/Oslo',
      })
    ).status,
  ).toBe(201);
  storeId = (await owner.request('/auth/session')).body.store.id;
});
it('returns saved brands and categories, including unused categories and inactive products, without case duplicates', async () => {
  const empty = await owner.request('/products/options');
  expect(empty.status).toBe(200);
  expect(empty.body).toEqual({ brands: [], categories: [] });
  for (const [index, brand, category] of [
    [1, ' Tine ', 'Dairy'],
    [2, 'tine', 'dairy'],
    [3, 'Coca-Cola', 'Drinks'],
  ] as const) {
    const result = await owner.request('/products', {
      name: 'Product ' + index,
      brand,
      category,
      unit: 'piece',
      sku: 'OPT-' + index,
      barcodes: [],
      minStock: '0',
    });
    expect(result.status).toBe(201);
  }
  await db.pool.query("UPDATE products SET active=false WHERE store_id=$1 AND brand='Coca-Cola'", [
    storeId,
  ]);
  await db.pool.query("INSERT INTO categories(store_id,name) VALUES($1,'Bakery')", [storeId]);
  const result = await owner.request('/products/options');
  expect(result.status).toBe(200);
  expect(result.body.brands).toEqual(['Coca-Cola', 'Tine']);
  expect(result.body.categories.map((s: string) => s.toLowerCase()).sort()).toEqual([
    'bakery',
    'dairy',
    'drinks',
  ]);
});
it('does not expose another shop names and requires catalog read permission', async () => {
  const previous = process.env.ALLOW_REGISTRATION;
  process.env.ALLOW_REGISTRATION = 'true';
  const other = new Client();
  try {
    expect(
      (
        await other.request('/auth/register', {
          storeName: 'Other options',
          ownerName: 'Other owner',
          email: 'other-options@local.test',
          password: 'owner-password-12345',
          currency: 'NOK',
          timezone: 'Europe/Oslo',
        })
      ).status,
    ).toBe(201);
  } finally {
    if (previous === undefined) delete process.env.ALLOW_REGISTRATION;
    else process.env.ALLOW_REGISTRATION = previous;
  }
  expect((await other.request('/products/options')).body).toEqual({ brands: [], categories: [] });
  expect((await new Client().request('/products/options')).status).toBe(401);
  const session = (await other.request('/auth/session')).body;
  const role = (await db.pool.query('SELECT role_id FROM employees WHERE id=$1', [session.user.id]))
    .rows[0].role_id;
  await db.pool.query('UPDATE roles SET permissions=$2 WHERE id=$1', [
    role,
    JSON.stringify(['catalog.write']),
  ]);
  expect((await other.request('/products/options')).status).toBe(403);
});
