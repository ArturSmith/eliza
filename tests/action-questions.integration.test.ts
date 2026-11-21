import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
import { storeToday } from '../packages/contracts/src/index';

const admin = new Database();
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_questions_test_${Date.now()}`;
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

const owner = new Client();
const register = new Client();
const account = {
  storeName: 'Dashboard test',
  ownerName: 'Owner',
  email: 'owner@pos.test',
  password: 'owner-password-12345',
  currency: 'NOK',
  timezone: 'Europe/Oslo',
};
let productId: string, freeProductId: string, shiftId: string;

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

let actor: any, supplierId: string;
beforeAll(async () => {
  expect(
    (await owner.request('/auth/setup', { ...account, email: 'questions@local.test' })).status,
  ).toBe(201);
  actor = (
    await db.pool.query(
      'SELECT s.id AS store,e.id AS employee,d.id AS device FROM stores s JOIN employees e ON e.store_id=s.id JOIN devices d ON d.store_id=s.id LIMIT 1',
    )
  ).rows[0];
  const products = (
    await db.pool.query(
      "INSERT INTO products(store_id,name,volume,sku,category,unit,price,cost,min_stock,stock,created_at) VALUES($1,'Milk','1 L','MILK','Dairy','piece',30,999,0,3,now()-interval '50 days'),($1,'Slow tea','500 ml','TEA','Drinks','piece',20,NULL,0,15,now()-interval '50 days') RETURNING id,sku",
      [actor.store],
    )
  ).rows;
  productId = products.find((p: any) => p.sku === 'MILK').id;
  freeProductId = products.find((p: any) => p.sku === 'TEA').id;
  for (const p of products) {
    await db.pool.query(
      "INSERT INTO movements(store_id,product_id,employee_id,device_id,quantity,balance,reason,notes,request_id,request_hash,created_at) VALUES($1,$2,$3,$4,100,100,'opening_balance','fixture',gen_random_uuid(),'fixture',now()-interval '50 days')",
      [actor.store, p.id, actor.employee, actor.device],
    );
    await db.pool.query(
      "INSERT INTO stock_batches(store_id,product_id,quantity,unit_cost,cost_source,expiry_date) VALUES($1,$2,$3,10,'adjustment',CASE WHEN $4 THEN (now() AT TIME ZONE 'Europe/Oslo')::date+2 ELSE NULL END)",
      [actor.store, p.id, p.sku === 'MILK' ? 3 : 15, p.sku === 'MILK'],
    );
  }
  supplierId = (
    await db.pool.query(
      "INSERT INTO suppliers(store_id,name,code) VALUES($1,'Supplier A','SUP-A') RETURNING id",
      [actor.store],
    )
  ).rows[0].id;
  await db.pool.query(
    'INSERT INTO supplier_products(store_id,supplier_id,product_id,pack_size,pack_cost,lead_time_days) VALUES($1,$2,$3,6,9999,3)',
    [actor.store, supplierId, productId],
  );
  shiftId = (
    await db.pool.query(
      "INSERT INTO shifts(store_id,device_id,employee_id,opening_cash,request_id,request_hash) VALUES($1,$2,$3,0,gen_random_uuid(),'fixture') RETURNING id",
      [actor.store, actor.device, actor.employee],
    )
  ).rows[0].id;
  for (const [daysAgo, quantity] of [
    [1, 28],
    [9, 7],
  ]) {
    const receipt = {
      cashierName: 'Owner',
      deviceName: 'Register',
      lines: [
        {
          productId,
          name: 'Milk',
          sku: 'MILK',
          category: 'Dairy',
          unit: 'piece',
          quantity: String(quantity),
          price: '30',
          total: String(quantity * 30),
          tax: '0',
          discount: '0',
        },
      ],
    };
    const sale = (
      await db.pool.query(
        "INSERT INTO sales(store_id,device_id,employee_id,shift_id,request_id,request_hash,receipt_number,total,tax,discount,receipt,created_at) VALUES($1,$2,$3,$4,gen_random_uuid(),'fixture',$5,$6,0,0,$7,now()-($8||' days')::interval) RETURNING id",
        [
          actor.store,
          actor.device,
          actor.employee,
          shiftId,
          'SALE-' + daysAgo,
          quantity * 30,
          receipt,
          daysAgo,
        ],
      )
    ).rows[0].id;
    await db.pool.query(
      'INSERT INTO sale_items(store_id,sale_id,product_id,quantity,price,cost,tax_rate,total,cost_total) VALUES($1,$2,$3,$4,30,10,0,$5,$6)',
      [actor.store, sale, productId, quantity, quantity * 30, quantity * 10],
    );
  }
});
it('answers the six questions using complete planning rows, real batches and immutable costs', async () => {
  const response = await owner.request('/reports/action-center/questions?period=week');
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const r = response.body;
  expect(r.planning).toMatchObject({ allowed: true, orderNow: 1, total: 1 });
  expect(r.planning.rows[0]).toMatchObject({
    productId,
    volume: '1 L',
    quantity: '18.000',
    dailySales: '1.250',
  });
  expect(r.expiry.total).toBe(1);
  expect(r.expiry.rows[0]).toMatchObject({ productId, quantity: '3.000', expired: false });
  expect(r.expiry.unknownProducts).toBe(1);
  expect(
    r.overstock.rows.some(
      (p: any) => p.productId === freeProductId && p.demandStatus === 'no_sales',
    ),
  ).toBe(true);
  expect(r.demand).toMatchObject({ receipts: 1, previousReceipts: 1 });
  expect(r.demand.rows[0]).toMatchObject({
    productId,
    quantity: '28.000',
    previousQuantity: '7.000',
    change: '21.000',
  });
  expect(r.assortment.rows[0]).toMatchObject({
    productId,
    volume: '1 L',
    grossProfit: '560.00',
    revenue: '840.00',
  });
  expect(r.range.to < r.today).toBe(true);
});
it('compares actual costs per selling unit and supplier, never reference catalogue prices', async () => {
  const other = (
    await db.pool.query(
      "INSERT INTO suppliers(store_id,name,code) VALUES($1,'Supplier B','SUP-B') RETURNING id",
      [actor.store],
    )
  ).rows[0].id;
  const order = (
    await db.pool.query(
      "INSERT INTO purchases(store_id,supplier_id,number,status,created_by,device_id,subtotal,tax,total) VALUES($1,$2,'PO-A','received',$3,$4,120,0,120) RETURNING id",
      [actor.store, supplierId, actor.employee, actor.device],
    )
  ).rows[0].id;
  const line = (
    await db.pool.query(
      "INSERT INTO purchase_lines(store_id,purchase_id,product_id,product_name,sku,unit,ordered_quantity,unit_cost,tax_rate,subtotal,tax,total) VALUES($1,$2,$3,'Milk','MILK','piece',12,10,0,120,0,120) RETURNING id",
      [actor.store, order, productId],
    )
  ).rows[0].id;
  for (const [index, cost, supplier] of [
    [1, 10, supplierId],
    [2, 12, supplierId],
    [3, 9, other],
  ] as const) {
    let purchase = order,
      purchaseLine = line;
    if (supplier === other) {
      purchase = (
        await db.pool.query(
          "INSERT INTO purchases(store_id,supplier_id,number,status,created_by,device_id,subtotal,tax,total) VALUES($1,$2,'PO-B','received',$3,$4,108,0,108) RETURNING id",
          [actor.store, other, actor.employee, actor.device],
        )
      ).rows[0].id;
      purchaseLine = (
        await db.pool.query(
          "INSERT INTO purchase_lines(store_id,purchase_id,product_id,product_name,sku,unit,ordered_quantity,unit_cost,tax_rate,subtotal,tax,total) VALUES($1,$2,$3,'Milk','MILK','piece',12,9,0,108,0,108) RETURNING id",
          [actor.store, purchase, productId],
        )
      ).rows[0].id;
    }
    const receipt = (
      await db.pool.query(
        "INSERT INTO goods_receipts(store_id,purchase_id,number,employee_id,device_id,subtotal,tax,total,created_at) VALUES($1,$2,$3,$4,$5,$6,0,$6,now()-($7||' days')::interval) RETURNING id",
        [actor.store, purchase, 'GR-' + index, actor.employee, actor.device, cost * 6, 5 - index],
      )
    ).rows[0].id;
    await db.pool.query(
      "INSERT INTO goods_receipt_lines(store_id,receipt_id,purchase_line_id,product_id,product_name,sku,unit,quantity,unit_cost,tax_rate,subtotal,tax,total) VALUES($1,$2,$3,$4,'Milk','MILK','piece',6,$5,0,$6,0,$6)",
      [actor.store, receipt, purchaseLine, productId, cost, cost * 6],
    );
  }
  const r = (await owner.request('/reports/action-center/questions')).body;
  expect(r.costs.rows.find((p: any) => p.supplierName === 'Supplier A')).toMatchObject({
    cost: '12.0000',
    previousCost: '10.0000',
    change: '20.00',
    alternativeSupplier: 'Supplier B',
    alternativeCost: '9.0000',
  });
  expect(JSON.stringify(r.costs)).not.toContain('9999');
});
it('gates every question on server permissions and rejects invalid periods', async () => {
  const role = (await db.pool.query('SELECT role_id FROM employees WHERE id=$1', [actor.employee]))
    .rows[0].role_id;
  const saved = (await db.pool.query('SELECT permissions FROM roles WHERE id=$1', [role])).rows[0]
    .permissions;
  try {
    await db.pool.query('UPDATE roles SET permissions=$2 WHERE id=$1', [
      role,
      JSON.stringify(['analytics.view']),
    ]);
    const r = await owner.request('/reports/action-center/questions');
    expect(r.status).toBe(200);
    for (const key of ['planning', 'expiry', 'overstock', 'costs', 'demand', 'assortment'])
      expect(r.body[key]).toMatchObject({ allowed: false, rows: [] });
    expect(JSON.stringify(r.body)).not.toContain('Supplier A');
    expect((await owner.request('/reports/action-center/questions?period=year')).status).toBe(400);
    expect((await new Client().request('/reports/action-center/questions')).status).toBe(401);
  } finally {
    await db.pool.query('UPDATE roles SET permissions=$2 WHERE id=$1', [
      role,
      JSON.stringify(saved),
    ]);
  }
});
it('does not let a second shop see the first shop records', async () => {
  const other = new Client();
  const previousRegistration = process.env.ALLOW_REGISTRATION;
  process.env.ALLOW_REGISTRATION = 'true';
  const registration = await other.request('/auth/register', {
    ...account,
    storeName: 'Second questions shop',
    email: 'second-questions@local.test',
  });
  if (previousRegistration === undefined) delete process.env.ALLOW_REGISTRATION;
  else process.env.ALLOW_REGISTRATION = previousRegistration;
  expect(registration.status).toBe(201);
  const r = await other.request('/reports/action-center/questions');
  expect(r.status).toBe(200);
  for (const key of ['planning', 'expiry', 'overstock', 'costs', 'demand', 'assortment'])
    expect(r.body[key].rows).toEqual([]);
});
