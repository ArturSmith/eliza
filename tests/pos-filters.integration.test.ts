import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
const admin = new Database();
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_pos_filters_test_${Date.now()}`;
let db: Database, app: Awaited<ReturnType<typeof createApp>>, url: string;
class Client {
  cookies = new Map<string, string>();
  async request(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
    const res = await fetch(url + '/api' + path, {
      method,
      headers: {
        Origin: 'http://localhost:5173',
        'X-Eliza-Request': '1',
        'Content-Type': 'application/json',
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of res.headers.getSetCookie()) {
      const [key, value] = cookie.split(';')[0].split('=');
      if (value) this.cookies.set(key, value);
      else this.cookies.delete(key);
    }
    return { status: res.status, body: await res.json() };
  }
}
const manager = new Client(),
  register = new Client(),
  second = new Client();
let cashierId: string,
  ownerId: string,
  cashierRole: string,
  ownerRole: string,
  productId: string,
  weightedId: string,
  shiftId: string,
  receiptId: string,
  deviceId: string;
const account = {
  storeName: 'Checkout test',
  ownerName: 'Owner',
  email: 'owner@pos.test',
  password: 'owner-password-12345',
  currency: 'NOK',
  timezone: 'Europe/Oslo',
};
const product = {
  name: 'Milk',
  sku: 'MILK',
  category: 'Dairy',
  unit: 'piece',
  price: '115.00',
  cost: '50.00',
  taxRate: '15',
  minStock: '2',
  plu: '101',
  barcodes: ['709100'],
};
function sale(overrides: Record<string, unknown> = {}) {
  return {
    requestId: crypto.randomUUID(),
    shiftId,
    lines: [{ productId, quantity: '1', expectedPrice: '115.00', expectedTaxRate: '15' }],
    discountPercent: '0',
    payment: { method: 'cash', tendered: '120.00' },
    ...overrides,
  };
}
async function unlock(client = register, employeeCode = 'ANNA', pin = '123456') {
  return client.request('/pos/login', { employeeCode, pin });
}
async function enroll(client: Client, label: string) {
  await client.request('/auth/login', { email: account.email, password: account.password });
  const result = await client.request('/pos/enroll', { name: label });
  expect(result.status).toBe(201);
  return result.body.id;
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
});
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.onModuleDestroy();
  process.env.DATABASE_URL = original;
  await admin.pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.onModuleDestroy();
});

let items: any[] = [];
describe.sequential('checkout catalog filters', () => {
  it('paginates available products in stable pages of 20', async () => {
    expect((await manager.request('/auth/setup', account)).status).toBe(201);
    const session = (await manager.request('/auth/session')).body;
    await manager.request(
      '/team/' + session.user.id,
      {
        name: 'Owner',
        employeeCode: 'OWNER',
        roleId: (await manager.request('/team/roles')).body.find((r: any) => r.name === 'Owner').id,
        active: true,
        pin: '654321',
      },
      'PATCH',
    );
    const roles = (await manager.request('/team/roles')).body;
    await manager.request('/team', {
      name: 'Anna',
      employeeCode: 'ANNA',
      roleId: roles.find((r: any) => r.name === 'Cashier').id,
      pin: '123456',
    });
    await enroll(register, 'Refund register');
    expect((await unlock(register)).status).toBe(200);
    shiftId = (
      await register.request('/pos/shifts', { requestId: crypto.randomUUID(), openingCash: '100' })
    ).body.id;

    for (let i = 0; i < 25; i++) {
      const item = (
        await manager.request('/products', {
          ...product,
          name: 'Item ' + String(i).padStart(2, '0'),
          sku: 'ITEM-' + i,
          plu: String(100 + i),
          barcodes: ['BAR' + i],
          category: i < 10 ? 'Drinks' : 'Food',
          price: '2',
          taxRate: '0',
        })
      ).body;
      items.push(item);
      expect(
        (
          await manager.request('/inventory/adjustments', {
            requestId: crypto.randomUUID(),
            productId: item.id,
            quantity: '20',
            reason: 'opening_balance',
          })
        ).status,
      ).toBe(201);
    }
    const unavailable = (
      await manager.request('/products', {
        ...product,
        name: 'No stock',
        sku: 'EMPTY',
        plu: '',
        barcodes: [],
      })
    ).body;
    const expired = (
      await manager.request('/products', {
        ...product,
        name: 'Expired',
        sku: 'EXPIRED',
        plu: '',
        barcodes: [],
      })
    ).body;
    await db.pool.query(
      'INSERT INTO stock_batches(store_id,product_id,quantity,expiry_date) SELECT store_id,id,10,CURRENT_DATE-1 FROM products WHERE id=$1',
      [expired.id],
    );
    await db.pool.query('UPDATE products SET stock=10 WHERE id=$1', [expired.id]);
    const first = await register.request('/pos/catalog');
    expect(first.status).toBe(200);
    expect(first.body.total).toBe(25);
    expect(first.body.products).toHaveLength(20);
    expect(first.body.products[0]).toMatchObject({
      price: '2.00',
      taxRate: '0.00',
      stock: '20.000',
    });
    expect(first.body.categories).toEqual(['Drinks', 'Food']);
    const last = (await register.request('/pos/catalog?page=2')).body;
    expect(last.products).toHaveLength(5);
    expect(last.products[0].id).toBe(items[20].id);
    expect((await register.request('/pos/catalog?page=3')).body.products).toEqual([]);
    for (const p of first.body.products) expect(p).not.toHaveProperty('cost');
    expect((await register.request('/pos/catalog?page=0')).status).toBe(400);
  });
  it('combines category, search, and persistent favorites without crossing employees', async () => {
    expect(
      (await register.request('/pos/products/' + items[0].id + '/favorite', { favorite: true }))
        .status,
    ).toBe(201);
    expect(
      (await register.request('/pos/products/' + items[20].id + '/favorite', { favorite: true }))
        .status,
    ).toBe(201);
    expect((await register.request('/pos/catalog?favorites=true')).body.total).toBe(2);
    expect(
      (await register.request('/pos/catalog?category=Food&favorites=true')).body.products.map(
        (p: any) => p.id,
      ),
    ).toEqual([items[20].id]);
    expect((await register.request('/pos/catalog?search=BAR24')).body.products[0].id).toBe(
      items[24].id,
    );
    expect((await register.request('/pos/products?code=BAR24')).body[0].id).toBe(items[24].id);
    const roles = (await manager.request('/team/roles')).body;
    await manager.request('/team', {
      name: 'Bob',
      employeeCode: 'BOB',
      roleId: roles.find((r: any) => r.name === 'Cashier').id,
      pin: '234567',
    });
    await enroll(second, 'Second');
    expect((await unlock(second, 'BOB', '234567')).status).toBe(200);
    expect((await second.request('/pos/catalog?favorites=true')).body.products).toEqual([]);
    expect(
      (await register.request('/pos/products/' + items[0].id + '/favorite', { favorite: false }))
        .status,
    ).toBe(201);
    expect((await register.request('/pos/catalog?favorites=true')).body.total).toBe(1);
    const other = (
      await db.pool.query(
        `INSERT INTO stores(organization_id,name,currency,timezone) SELECT organization_id,'Private','NOK','Europe/Oslo' FROM stores LIMIT 1 RETURNING id`,
      )
    ).rows[0];
    const foreign = (
      await db.pool.query(
        `INSERT INTO products(store_id,name,sku,category,unit,price,cost,min_stock,stock) VALUES($1,'Private product','PRIVATE','Food','piece',2,1,0,0) RETURNING id`,
        [other.id],
      )
    ).rows[0];
    expect(
      (await register.request('/pos/products/' + foreign.id + '/favorite', { favorite: true }))
        .status,
    ).toBe(404);
    expect((await register.request('/pos/products?code=PRIVATE')).body).toEqual([]);
  });
  it('ranks by sales in the last 30 days and keeps category filters', async () => {
    const response = await register.request(
      '/pos/sales',
      sale({
        lines: [
          { productId: items[24].id, quantity: '3', expectedPrice: '2.00', expectedTaxRate: '0' },
        ],
        payment: { method: 'cash', tendered: '6' },
      }),
    );
    expect(response.status).toBe(201);
    const popular = (await register.request('/pos/catalog?popular=true')).body;
    expect(popular.products[0].id).toBe(items[24].id);
    expect((await register.request('/pos/catalog?popular=true&category=Drinks')).body.total).toBe(
      10,
    );
    expect(
      (await register.request('/pos/catalog?popular=true&favorites=true')).body.products[0].id,
    ).toBe(items[20].id);
  });
});
