import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
const admin = new Database();
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_analytics_test_${Date.now()}`;
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

const manager = new Client();
let store: string,
  owner: string,
  device: string,
  milk: string,
  apples: string,
  unsold: string,
  shift1: string,
  shift2: string,
  emptyShift: string;
const uid = () => crypto.randomUUID();
async function createShift(label: string) {
  const id = uid();
  await db.pool.query(
    "INSERT INTO shifts(id,store_id,device_id,employee_id,status,opening_cash,opened_at,closed_at,request_id,request_hash,notes) VALUES($1,$2,$3,$4,'closed',0,'2020-03-29T00:00:00Z','2020-03-30T23:00:00Z',$5,'fixture',$6)",
    [id, store, device, owner, uid(), label],
  );
  return id;
}
async function sale(
  shift: string,
  time: string,
  items: { id: string; total: number; qty: number }[],
) {
  const id = uid(),
    total = items.reduce((sum, i) => sum + i.total, 0);
  const receipt = {
    cashierName: 'Owner',
    deviceName: 'Register 01',
    lines: items.map((i) => ({
      productId: i.id,
      name: i.id === milk ? 'Milk' : 'Apples',
      sku: i.id === milk ? 'MILK' : 'APPLES',
      unit: 'piece',
      quantity: String(i.qty),
      total: i.total.toFixed(2),
      tax: '0.00',
      discount: '0.00',
      category: 'Food',
    })),
  };
  await db.pool.query(
    "INSERT INTO sales(id,store_id,device_id,employee_id,shift_id,request_id,request_hash,receipt_number,total,tax,discount,receipt,created_at) VALUES($1,$2,$3,$4,$5,$6,'fixture',$7,$8,0,0,$9,$10)",
    [id, store, device, owner, shift, uid(), uid(), total, receipt, time],
  );
  for (const i of items)
    await db.pool.query(
      'INSERT INTO sale_items(store_id,sale_id,product_id,quantity,price,cost,tax_rate,total) VALUES($1,$2,$3,$4,$5,10,0,$6)',
      [store, id, i.id, i.qty, i.total / i.qty, i.total],
    );
  // Two payment rows must not multiply receipt totals.
  for (const method of ['cash', 'card'])
    await db.pool.query(
      'INSERT INTO payments(store_id,sale_id,method,amount,tendered,change) VALUES($1,$2,$3,$4,$4,0)',
      [store, id, method, total / 2],
    );
  return id;
}
beforeAll(async () => {
  expect(
    (
      await manager.request('/auth/setup', {
        storeName: 'Analytics test',
        ownerName: 'Owner',
        email: 'owner@analytics.test',
        password: 'analytics-password-12345',
        currency: 'NOK',
        timezone: 'Europe/Oslo',
      })
    ).status,
  ).toBe(201);
  const session = (await manager.request('/auth/session')).body;
  store = session.store.id;
  owner = session.user.id;
  device = (await db.pool.query('SELECT id FROM devices WHERE store_id=$1 LIMIT 1', [store]))
    .rows[0].id;
  const ids = [];
  for (const [name, sku] of [
    ['Milk', 'MILK'],
    ['Apples', 'APPLES'],
    ['Unsold item', 'UNSOLD'],
  ]) {
    ids.push(
      (
        await manager.request('/products', {
          name,
          sku,
          category: 'Food',
          unit: 'piece',
          price: '100',
          cost: '10',
          minStock: '0',
          barcodes: [],
          plu: '',
        })
      ).body.id,
    );
  }
  [milk, apples, unsold] = ids;
  await db.pool.query("UPDATE products SET created_at='2019-01-01' WHERE store_id=$1", [store]);
  shift1 = await createShift('First');
  shift2 = await createShift('Second');
  emptyShift = await createShift('Empty');
  const first = await sale(shift1, '2020-03-29T00:30:00Z', [
    { id: milk, total: 100, qty: 1 },
    { id: apples, total: 50, qty: 1 },
  ]);
  await sale(shift1, '2020-03-29T01:30:00Z', [{ id: milk, total: 100, qty: 1 }]);
  await sale(shift2, '2020-03-29T10:00:00Z', [{ id: milk, total: 200, qty: 2 }]);
  await sale(shift2, '2020-03-29T22:00:00Z', [{ id: milk, total: 1000, qty: 10 }]);
  const refund = uid();
  await db.pool.query(
    "INSERT INTO refunds(id,store_id,sale_id,shift_id,employee_id,device_id,approver_id,request_id,request_hash,number,method,reason,total,tax,receipt,created_at) VALUES($1,$2,$3,$4,$5,$6,$5,$7,'fixture',$8,'cash','Return',25,0,'{}','2020-03-30T10:00:00Z')",
    [refund, store, first, shift2, owner, device, uid(), uid()],
  );
  await db.pool.query(
    'INSERT INTO refund_lines(store_id,refund_id,sale_id,product_id,quantity,restock,total,tax) VALUES($1,$2,$3,$4,0.25,true,25,0)',
    [store, refund, first, milk],
  );
});
const path = '/reports/analytics?from=2020-03-29&to=2020-03-29';
it('uses one consistent total across time, product, shift and payment dimensions', async () => {
  const r = await manager.request(path);
  expect(r.status).toBe(200);
  expect(r.body.totals).toMatchObject({
    total: '450.00',
    transactions: '3',
    cash: '225.00',
    card: '225.00',
    average: '150.00',
  });
  for (const group of [
    'day',
    'month',
    'year',
    'hour',
    'product',
    'shift',
    'cashier',
    'register',
    'category',
    'payment',
  ])
    expect(r.body.groups[group].reduce((sum: number, row: any) => sum + Number(row.total), 0)).toBe(
      450,
    );
  expect(r.body.groups.hour.find((r: any) => r.bucket === '01').total).toBe('150.00');
  expect(r.body.groups.hour.find((r: any) => r.bucket === '03').total).toBe('100.00');
  expect(r.body.groups.product.find((r: any) => r.bucket === unsold).total).toBe('0');
  expect(r.body.groups.shift.find((r: any) => r.bucket === emptyShift).transactions).toBe('0');
});
it('intersects product, shift and dates without counting the rest of the basket', async () => {
  const filter = '&productId=' + milk + '&shiftId=' + shift1;
  const r = await manager.request(path + filter);
  expect(r.status).toBe(200);
  expect(r.body.totals).toMatchObject({
    total: '200.00',
    transactions: '2',
    cash: null,
    card: null,
    average: '100.00',
  });
  expect(r.body.groups.product).toHaveLength(1);
  expect(r.body.groups.product[0].bucket).toBe(milk);
  expect(r.body.groups.payment ?? []).toHaveLength(0);
  const profit = await manager.request(
    '/reports/gross-profit?from=2020-03-29&to=2020-03-29' + filter,
  );
  expect(profit.status).toBe(200);
  expect(profit.body).toMatchObject({
    netRevenue: '200.00',
    costOfGoodsSold: '20.00',
    grossProfit: '180.00',
  });
});
it('attributes refunds to issue date and original sale shift', async () => {
  const r = await manager.request(
    '/reports/analytics?from=2020-03-30&to=2020-03-30&productId=' + milk + '&shiftId=' + shift1,
  );
  expect(r.body.totals).toMatchObject({ total: '0', refunds: '25.00', net: '-25.00' });
  const profit = await manager.request(
    '/reports/gross-profit?from=2020-03-30&to=2020-03-30&productId=' + milk + '&shiftId=' + shift1,
  );
  expect(profit.body).toMatchObject({
    netRevenue: '-25.00',
    restoredCost: '2.50',
    grossProfit: '-22.50',
  });
});
it('validates filters, returns empty ranges, and enforces authentication and tenant isolation', async () => {
  for (const suffix of ['&productId=bad', '&shiftId=bad'])
    expect((await manager.request(path + suffix)).status).toBe(400);
  expect((await manager.request('/reports/analytics?from=2026-02-30&to=2026-03-02')).status).toBe(
    400,
  );
  expect((await new Client().request(path)).status).toBe(401);
  const empty = await manager.request(path + '&productId=' + uid() + '&shiftId=' + uid());
  expect(empty.body.totals.transactions).toBe('0');
  const otherStore = (
    await db.pool.query(
      "INSERT INTO stores(organization_id,name,currency,timezone) SELECT organization_id,'Other','NOK','Europe/Oslo' FROM stores WHERE id=$1 RETURNING id",
      [store],
    )
  ).rows[0].id;
  const otherRole = (
    await db.pool.query(
      "INSERT INTO roles(store_id,name,permissions) VALUES($1,'Owner',$2) RETURNING id",
      [otherStore, JSON.stringify(['sales.read'])],
    )
  ).rows[0].id;
  await db.pool.query(
    "INSERT INTO employees(store_id,role_id,name,email,password_hash,employee_code) SELECT $1,$2,'Other','other@analytics.test',password_hash,'OWNER' FROM employees WHERE id=$3",
    [otherStore, otherRole, owner],
  );
  const other = new Client();
  expect(
    (
      await other.request('/auth/login', {
        email: 'other@analytics.test',
        password: 'analytics-password-12345',
      })
    ).status,
  ).toBe(200);
  const isolated = await other.request(path + '&productId=' + milk + '&shiftId=' + shift1);
  expect(isolated.status).toBe(200);
  expect(isolated.body.totals.transactions).toBe('0');
  expect(isolated.body.options.products).toHaveLength(0);
  expect(isolated.body.options.shifts).toHaveLength(0);
});
