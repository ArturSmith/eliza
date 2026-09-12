import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
import { passwordHash } from '../apps/api/dist/security.js';
const admin = new Database();
const originalUrl =
  process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_test_${Date.now()}`;
let database: Database,
  app: Awaited<ReturnType<typeof createApp>>,
  url: string,
  ownerCookie: string,
  productId: string;
const owner = {
  storeName: 'Integration Store',
  ownerName: 'Test Owner',
  email: 'owner@example.test',
  password: 'test-password-12345',
  currency: 'NOK',
  timezone: 'Europe/Oslo',
};
const product = {
  name: 'Test milk',
  sku: 'MILK-001',
  category: 'Dairy',
  unit: 'piece',
  price: '29.90',
  cost: '16.50',
  minStock: '5',
  plu: '101',
  barcodes: ['709000001'],
};
async function request(
  path: string,
  body?: unknown,
  cookie = ownerCookie,
  method = body === undefined ? 'GET' : 'POST',
) {
  const res = await fetch(url + '/api' + path, {
    method,
    headers: {
      Origin: 'http://localhost:5173',
      'X-Eliza-Request': '1',
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await res.json();
  return {
    status: res.status,
    body: json,
    cookie: res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; '),
  };
}
beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE ${name}`);
  const dbUrl = new URL(originalUrl);
  dbUrl.pathname = `/${name}`;
  process.env.DATABASE_URL = dbUrl.toString();
  execFileSync(process.execPath, ['apps/api/dist/migrate.js'], { env: process.env });
  execFileSync(process.execPath, ['apps/api/dist/migrate.js'], { env: process.env });
  database = new Database();
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});
afterAll(async () => {
  if (app) await app.close();
  if (database) await database.onModuleDestroy();
  process.env.DATABASE_URL = originalUrl;
  await admin.pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.onModuleDestroy();
});
describe.sequential('foundation against real PostgreSQL', () => {
  it('requires authentication and same-origin mutation headers', async () => {
    expect((await request('/products')).status).toBe(401);
    const res = await fetch(url + '/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(owner),
    });
    expect(res.status).toBe(403);
  });
  it('creates one local owner with a session and prevents second setup', async () => {
    expect((await request('/auth/status')).body.needsSetup).toBe(true);
    const result = await request('/auth/setup', owner);
    expect(result.status).toBe(201);
    ownerCookie = result.cookie;
    expect((await request('/auth/session')).body.user.name).toBe('Test Owner');
    expect((await request('/auth/setup', owner)).status).toBe(409);
    expect((await request('/auth/status')).body.needsSetup).toBe(false);
    const stored = await database.pool.query('SELECT password_hash FROM employees');
    expect(stored.rows[0].password_hash).not.toContain(owner.password);
  });
  it('creates barcode and barcode-free products', async () => {
    const result = await request('/products', product);
    expect(result.status).toBe(201);
    productId = result.body.id;
    expect(result.body.stock).toBe('0.000');
    expect(
      (
        await request('/products', {
          ...product,
          name: 'Bread',
          sku: 'BREAD',
          plu: '',
          barcodes: [],
        })
      ).status,
    ).toBe(201);
  });
  it('saves, preserves, and removes product photos and rejects unsafe image inputs', async () => {
    const image = 'data:image/jpeg;base64,/9j/2Q==';
    expect(
      (await request('/products/' + productId, { ...product, image }, ownerCookie, 'PATCH')).status,
    ).toBe(200);
    expect((await request('/products')).body.find((p: any) => p.id === productId).image).toBe(
      image,
    );
    await request('/products/' + productId, product, ownerCookie, 'PATCH');
    expect((await request('/products')).body.find((p: any) => p.id === productId).image).toBe(
      image,
    );
    for (const invalid of [
      'https://external.test/photo.jpg',
      'data:image/svg+xml;base64,PHN2Zz4=',
      image + 'A'.repeat(60000),
    ]) {
      expect(
        (
          await request(
            '/products/' + productId,
            { ...product, image: invalid },
            ownerCookie,
            'PATCH',
          )
        ).status,
      ).toBe(400);
    }
    await request('/products/' + productId, { ...product, image: '' }, ownerCookie, 'PATCH');
    expect((await request('/products')).body.find((p: any) => p.id === productId).image).toBe('');
  });
  it('rolls back a product when a barcode conflicts', async () => {
    const result = await request('/products', { ...product, sku: 'FAILED', plu: '102' });
    expect(result.status).toBe(409);
    const rows = await database.pool.query("SELECT id FROM products WHERE sku='FAILED'");
    expect(rows.rowCount).toBe(0);
  });
  it('keeps product and barcode edits atomic', async () => {
    const result = await request(
      `/products/${productId}`,
      { ...product, name: 'Whole milk', barcodes: ['709000001', '709000002'] },
      ownerCookie,
      'PATCH',
    );
    expect(result.status).toBe(200);
    const list = await request('/products');
    expect(list.body.find((p: any) => p.id === productId).barcodes).toHaveLength(2);
  });
  it('records opening stock exactly once even under duplicate concurrent requests', async () => {
    const body = {
      productId,
      quantity: '20',
      reason: 'opening_balance',
      notes: 'Initial count',
      requestId: crypto.randomUUID(),
    };
    const results = await Promise.all([
      request('/inventory/adjustments', body),
      request('/inventory/adjustments', body),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0].body.id).toBe(results[1].body.id);
    expect(results[0].body.balance).toBe('20.000');
    expect((await request('/inventory/adjustments', { ...body, quantity: '21' })).status).toBe(409);
  });
  it('serializes concurrent adjustments without losing stock changes', async () => {
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map(() =>
        request('/inventory/adjustments', {
          productId,
          quantity: '-1',
          reason: 'damaged',
          requestId: crypto.randomUUID(),
        }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const stock = await database.pool.query('SELECT stock FROM products WHERE id=$1', [productId]);
    expect(stock.rows[0].stock).toBe('15.000');
  });
  it('rejects negative stock, fractional pieces, and repeated opening balance', async () => {
    for (const body of [
      { quantity: '-16', reason: 'damaged' },
      { quantity: '1.5', reason: 'received' },
      { quantity: '-1', reason: 'received' },
    ]) {
      expect(
        (
          await request('/inventory/adjustments', {
            ...body,
            productId,
            requestId: crypto.randomUUID(),
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await request('/inventory/adjustments', {
          productId,
          quantity: '1',
          reason: 'opening_balance',
          requestId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(409);
    const stock = await database.pool.query('SELECT stock FROM products WHERE id=$1', [productId]);
    expect(stock.rows[0].stock).toBe('15.000');
  });
  it('records exact fractional quantities for weighted products', async () => {
    const created = await request('/products', {
      ...product,
      name: 'Apples',
      sku: 'APPLE',
      unit: 'kilogram',
      plu: '4011',
      barcodes: [],
    });
    const body = {
      productId: created.body.id,
      quantity: '1.350',
      reason: 'opening_balance',
      requestId: crypto.randomUUID(),
    };
    expect((await request('/inventory/adjustments', body)).body.balance).toBe('1.350');
    expect(
      (
        await request('/inventory/adjustments', {
          ...body,
          quantity: '-0.125',
          reason: 'damaged',
          requestId: crypto.randomUUID(),
        })
      ).body.balance,
    ).toBe('1.225');
  });
  it('preserves stock and history when deactivating a product', async () => {
    expect(
      (await request(`/products/${productId}/status`, { active: false }, ownerCookie, 'PATCH'))
        .status,
    ).toBe(200);
    expect(
      (
        await request('/inventory/adjustments', {
          productId,
          quantity: '1',
          reason: 'received',
          requestId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(400);
    expect((await request('/inventory/movements')).body.length).toBe(8);
  });
  it('enforces append-only movement and audit history in the database', async () => {
    await expect(
      database.pool.query('DELETE FROM movements WHERE product_id=$1', [productId]),
    ).rejects.toThrow('append-only');
    await expect(database.pool.query("UPDATE audits SET action='Changed'")).rejects.toThrow(
      'append-only',
    );
  });
  it('enforces permissions server-side', async () => {
    const role = await database.pool.query("SELECT id,store_id FROM roles WHERE name='Cashier'");
    const r = role.rows[0];
    await database.pool.query(
      'INSERT INTO employees(store_id,role_id,name,email,password_hash) VALUES($1,$2,$3,$4,$5)',
      [
        r.store_id,
        r.id,
        'Cashier',
        'cashier@example.test',
        await passwordHash('cashier-test-password'),
      ],
    );
    const login = await request(
      '/auth/login',
      { email: 'cashier@example.test', password: 'cashier-test-password' },
      '',
    );
    expect(login.status).toBe(200);
    const catalog = await request('/products', undefined, login.cookie);
    expect(catalog.status).toBe(200);
    expect(catalog.body.every((p: any) => p.cost === null)).toBe(true);
    expect((await request('/products', product, login.cookie)).status).toBe(403);
    expect((await request('/inventory/movements', undefined, login.cookie)).status).toBe(403);
    expect((await request('/audit', undefined, login.cookie)).status).toBe(403);
  });
  it('isolates another store even when its product ID is known', async () => {
    const org = (
      await database.pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id', [
        'Other business',
      ])
    ).rows[0].id;
    const store = (
      await database.pool.query(
        'INSERT INTO stores(organization_id,name,currency,timezone) VALUES($1,$2,$3,$4) RETURNING id',
        [org, 'Other store', 'EUR', 'UTC'],
      )
    ).rows[0].id;
    const other = (
      await database.pool.query(
        "INSERT INTO products(store_id,name,sku,category,unit,price,cost,min_stock) VALUES($1,'Private','PRIVATE','Test','piece',1,1,1) RETURNING id",
        [store],
      )
    ).rows[0].id;
    expect((await request('/products')).body.some((p: any) => p.id === other)).toBe(false);
    expect(
      (await request(`/products/${other}/status`, { active: false }, ownerCookie, 'PATCH')).status,
    ).toBe(404);
    expect(
      (
        await request('/inventory/adjustments', {
          productId: other,
          quantity: '1',
          reason: 'received',
          requestId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(404);
  });
  it('revokes a blocked device session immediately and never returns token hashes', async () => {
    const session = await request('/auth/session');
    const list = await request('/devices');
    expect(JSON.stringify(list.body)).not.toContain('tokenHash');
    expect(
      (
        await request(
          `/devices/${session.body.device.id}`,
          { name: 'Blocked browser', active: false },
          ownerCookie,
          'PATCH',
        )
      ).status,
    ).toBe(200);
    expect((await request('/products')).status).toBe(401);
  });
  it('rejects invalid passwords and invalidates logout sessions', async () => {
    expect(
      (await request('/auth/login', { email: owner.email, password: 'incorrect' }, '')).status,
    ).toBe(401);
    const login = await request(
      '/auth/login',
      { email: owner.email, password: owner.password },
      '',
    );
    expect(login.status).toBe(200);
    expect((await request('/auth/logout', {}, login.cookie)).status).toBe(200);
    expect((await request('/auth/session', undefined, login.cookie)).status).toBe(401);
  });
});
