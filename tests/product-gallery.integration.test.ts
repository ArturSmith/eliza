import { beforeAll, afterAll, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';

const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_gallery_test_${Date.now()}`;
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
it('lets a catalog editor save photos without disclosing or clearing a hidden purchase cost', async () => {
  const owner = new Client(),
    editor = new Client();
  expect(
    (
      await owner.request('/auth/setup', {
        storeName: 'Gallery permissions',
        ownerName: 'Owner',
        email: 'owner@gallery.test',
        password: 'owner-password-12345',
        currency: 'NOK',
        timezone: 'Europe/Oslo',
      })
    ).status,
  ).toBe(201);
  const session = (await owner.request('/auth/session')).body;
  const role = (
    await db.pool.query(
      "INSERT INTO roles(store_id,name,permissions) VALUES($1,'Catalog editor',$2::jsonb) RETURNING id",
      [session.store.id, JSON.stringify(['catalog.read', 'catalog.write'])],
    )
  ).rows[0];
  const account = { email: 'editor@gallery.test', password: 'editor-password-12345' };
  expect(
    (
      await owner.request('/team', {
        ...account,
        name: 'Catalog editor',
        employeeCode: 'EDITOR',
        roleId: role.id,
        pin: '123456',
      })
    ).status,
  ).toBe(201);
  const front = 'data:image/jpeg;base64,/9j/AA==',
    back = 'data:image/jpeg;base64,/9j/BB==';
  const created = await owner.request('/products', {
    name: 'Yogurt',
    sku: 'YOG',
    category: 'Dairy',
    unit: 'piece',
    price: '70',
    cost: '59',
    minStock: '2',
    barcodes: [],
    images: [front, back],
  });
  expect(created.status).toBe(201);
  expect((await editor.request('/auth/login', account)).status).toBe(200);
  const visible = (await editor.request('/products')).body[0];
  expect(visible.cost).toBeNull();
  const edited = await editor.request(
    '/products/' + created.body.id,
    { ...visible, description: 'Added by floor staff', images: [back, front], cost: null },
    'PATCH',
  );
  expect(edited.status).toBe(200);
  expect(edited.body).toMatchObject({ cost: null, image: back, images: [back, front] });
  const stored = (
    await db.pool.query(
      'SELECT cost::text,price::text,stock::text,images FROM products WHERE id=$1',
      [created.body.id],
    )
  ).rows[0];
  expect(stored).toMatchObject({
    cost: '59.00',
    price: '70.00',
    stock: '0.000',
    images: [back, front],
  });
  const attemptedCostChange = await editor.request(
    '/products/' + created.body.id,
    { ...edited.body, cost: '1.00' },
    'PATCH',
  );
  expect(attemptedCostChange.body.cost).toBeNull();
  expect((await owner.request('/products')).body[0].cost).toBe('59.00');
});
