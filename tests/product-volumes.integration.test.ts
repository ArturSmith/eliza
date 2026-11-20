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

const owner = new Client();
const shared = {
  name: 'Variant soda',
  description: 'Same drink',
  brand: 'Cola',
  category: 'Drinks',
  unit: 'piece',
  price: '30',
  minStock: '2',
  taxRate: '15',
};
beforeAll(async () => {
  const setup = await owner.request('/auth/setup', {
    storeName: 'Volumes shop',
    ownerName: 'Owner',
    email: 'owner@volumes.test',
    password: 'owner-password-12345',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  });
  expect(setup.status).toBe(201);
});
it('creates independent volume products, sharing catalog details and linking each to a supplier', async () => {
  const supplier = await owner.request('/suppliers', {
    requestId: crypto.randomUUID(),
    code: 'VOLUMES',
    name: 'Drinks supplier',
  });
  expect(supplier.status).toBe(201);
  const result = await owner.request('/products/variants', {
    ...shared,
    supplierId: supplier.body.id,
    variants: [
      { volume: '330 ml', barcode: '5901234123457' },
      { volume: '500 ml', barcode: '5901234123464' },
      { volume: '1 L', barcode: '5901234123471' },
    ],
  });
  expect(result.status).toBe(201);
  const rows = result.body;
  expect(rows).toHaveLength(3);
  expect(new Set(rows.map((row: any) => row.id)).size).toBe(3);
  expect(new Set(rows.map((row: any) => row.sku)).size).toBe(3);
  expect(new Set(rows.map((row: any) => row.plu)).size).toBe(3);
  expect(rows.map((row: any) => row.volume)).toEqual(['330 ml', '500 ml', '1 L']);
  for (const row of rows) {
    expect(row).toMatchObject({
      name: shared.name,
      brand: shared.brand,
      description: shared.description,
      category: shared.category,
      price: '30.00',
      cost: null,
      stock: '0.000',
      unit: 'piece',
      taxRate: '15.00',
    });
    expect(row.barcodes).toHaveLength(1);
    const found = await owner.request('/products/lookup/' + row.barcodes[0]);
    expect(found.body.existing.id).toBe(row.id);
    const links = await db.pool.query('SELECT * FROM supplier_products WHERE product_id=$1', [
      row.id,
    ]);
    expect(links.rows).toHaveLength(1);
    expect(links.rows[0]).toMatchObject({ supplier_id: supplier.body.id, pack_cost: null });
  }
});
it('rolls back every product and audit if a later barcode conflicts, then accepts a corrected retry', async () => {
  const variants = [
    { volume: '250 ml', barcode: '5901234123488' },
    { volume: '750 ml', barcode: '5901234123457' },
  ];
  const before = (await db.pool.query('SELECT count(*) FROM audits')).rows[0].count;
  const failed = await owner.request('/products/variants', {
    ...shared,
    name: 'Atomic soda',
    variants,
  });
  expect(failed.status).toBe(409);
  expect(
    (await db.pool.query("SELECT * FROM products WHERE name='Atomic soda'")).rows,
  ).toHaveLength(0);
  expect((await db.pool.query('SELECT count(*) FROM audits')).rows[0].count).toBe(before);
  const retried = await owner.request('/products/variants', {
    ...shared,
    name: 'Atomic soda',
    variants: [variants[0], { ...variants[1], barcode: '5901234123495' }],
  });
  expect(retried.status).toBe(201);
  expect(retried.body).toHaveLength(2);
});
it('rejects repeated or missing variant identifiers without inserting products', async () => {
  for (const variants of [
    [
      { volume: '1 L', barcode: 'a' },
      { volume: '2 L', barcode: 'a' },
    ],
    [
      { volume: '1 L', barcode: 'a' },
      { volume: '1 l', barcode: 'b' },
    ],
    [
      { volume: '1 L', barcode: 'a' },
      { volume: '', barcode: 'b' },
    ],
    [
      { volume: '1 L', barcode: 'a' },
      { volume: '2 L', barcode: '' },
    ],
    [{ volume: '1 L', barcode: 'a' }],
  ]) {
    expect(
      (await owner.request('/products/variants', { ...shared, name: 'Invalid soda', variants }))
        .status,
    ).toBe(400);
  }
  expect(
    (await db.pool.query("SELECT * FROM products WHERE name='Invalid soda'")).rows,
  ).toHaveLength(0);
});
it('allocates independent codes across simultaneous variant batches', async () => {
  const results = await Promise.all(
    ['one', 'two'].map((suffix) =>
      owner.request('/products/variants', {
        ...shared,
        variants: [
          { volume: '1 L', barcode: 'concurrent-a-' + suffix },
          { volume: '2 L', barcode: 'concurrent-b-' + suffix },
        ],
      }),
    ),
  );
  expect(results.map((result) => result.status)).toEqual([201, 201]);
  const rows = results.flatMap((result) => result.body);
  expect(new Set(rows.map((row) => row.plu)).size).toBe(4);
  expect(new Set(rows.map((row) => row.sku)).size).toBe(4);
});
it('supports normal products, source imports and editing without clearing fields for older clients', async () => {
  const result = await owner.request('/products', {
    ...shared,
    sku: 'single',
    volume: '2 L',
    barcodes: [],
  });
  expect(result.status).toBe(201);
  expect(result.body).toMatchObject({ brand: 'Cola', volume: '2 L' });
  const { brand, volume, ...legacy } = result.body;
  const edited = await owner.request(
    '/products/' + result.body.id,
    { ...legacy, description: 'Edited' },
    'PATCH',
  );
  expect(edited.status).toBe(200);
  expect(edited.body).toMatchObject({ brand: 'Cola', volume: '2 L', description: 'Edited' });
  const changed = await owner.request(
    '/products/' + result.body.id,
    { ...edited.body, brand: 'New brand', volume: '3 L' },
    'PATCH',
  );
  expect(changed.body).toMatchObject({ brand: 'New brand', volume: '3 L' });
  const imported = await owner.request('/products', {
    ...shared,
    brand: undefined,
    sku: 'imported',
    barcodes: [],
    source: {
      barcode: '5901234123457',
      brand: 'Imported brand',
      quantity: '125 ml',
      imageImported: false,
    },
  });
  expect(imported.status).toBe(201);
  expect(imported.body).toMatchObject({ brand: 'Imported brand', volume: '125 ml' });
});
