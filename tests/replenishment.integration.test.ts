import { executeAiTool } from '../apps/api/dist/ai-tools.js';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
import { ReplenishmentService } from '../apps/api/dist/replenishment.js';
import { storeToday } from '../packages/contracts/src/index';
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_replenishment_${Date.now()}`;
const admin = new Database();
let db: Database,
  app: Awaited<ReturnType<typeof createApp>>,
  url: string,
  cookie: string,
  req: any,
  productId: string;
beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE ${name}`);
  const target = new URL(original);
  target.pathname = '/' + name;
  process.env.DATABASE_URL = target.toString();
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
describe.sequential('replenishment facts and boundaries', () => {
  it('uses closed local days, expired batches, supplier packs and zero-sales catalogue products', async () => {
    const setup = await fetch(url + '/api/auth/setup', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        'X-Eliza-Request': '1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        storeName: 'Demand shop',
        ownerName: 'Owner',
        email: 'demand@example.test',
        password: 'owner-password-12345',
        currency: 'NOK',
        timezone: 'Europe/Oslo',
      }),
    });
    expect(setup.status).toBe(201);
    cookie = setup.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; ');
    const actor = (
      await db.pool.query(
        'SELECT s.id AS store,e.id AS employee,d.id AS device FROM stores s JOIN employees e ON e.store_id=s.id JOIN devices d ON d.store_id=s.id LIMIT 1',
      )
    ).rows[0];
    req = {
      context: {
        store: { id: actor.store, timezone: 'Europe/Oslo', currency: 'NOK' },
        user: { permissions: ['sales.read', 'inventory.read', 'purchases.read', 'suppliers.read'] },
      },
    };
    const today = storeToday(new Date(), 'Europe/Oslo');
    const products = (
      await db.pool.query(
        "INSERT INTO products(store_id,name,sku,category,unit,price,cost,min_stock,stock,created_at) VALUES($1,'Demand milk','DEMAND','Dairy','piece',10,5,0,5,now()-interval '40 days'),($1,'No sales milk','NO-SALES','Dairy','piece',10,5,0,10,now()-interval '40 days'),($1,'New product','NEW','Dairy','piece',10,5,0,1,now()) RETURNING id,sku",
        [actor.store],
      )
    ).rows;
    productId = products.find((p: any) => p.sku === 'DEMAND').id;
    for (const p of products) {
      await db.pool.query(
        "INSERT INTO movements(store_id,product_id,employee_id,device_id,quantity,balance,reason,notes,request_id,request_hash,created_at) VALUES($1,$2,$3,$4,100,100,'opening_balance','fixture',gen_random_uuid(),'fixture',CASE WHEN $5 THEN now() ELSE now()-interval '40 days' END)",
        [actor.store, p.id, actor.employee, actor.device, p.sku === 'NEW'],
      );
      await db.pool.query(
        "INSERT INTO stock_batches(store_id,product_id,quantity,unit_cost,cost_source) VALUES($1,$2,$3,5,'adjustment')",
        [actor.store, p.id, p.sku === 'DEMAND' ? 3 : p.sku === 'NEW' ? 1 : 10],
      );
    }
    await db.pool.query(
      "INSERT INTO stock_batches(store_id,product_id,quantity,unit_cost,cost_source,expiry_date) VALUES($1,$2,2,5,'adjustment',$3::date-1)",
      [actor.store, productId, today],
    );
    const supplier = (
      await db.pool.query(
        "INSERT INTO suppliers(store_id,name,code) VALUES($1,'Milk supplier','MILK') RETURNING id",
        [actor.store],
      )
    ).rows[0].id;
    await db.pool.query(
      'INSERT INTO supplier_products(store_id,supplier_id,product_id,pack_size,pack_cost,lead_time_days) VALUES($1,$2,$3,6,30,3)',
      [actor.store, supplier, productId],
    );
    const shift = (
      await db.pool.query(
        "INSERT INTO shifts(store_id,device_id,employee_id,opening_cash,request_id,request_hash) VALUES($1,$2,$3,0,gen_random_uuid(),'fixture') RETURNING id",
        [actor.store, actor.device, actor.employee],
      )
    ).rows[0].id;
    for (const quantity of [28, 100]) {
      const timestamp = (
        await db.pool.query(
          "SELECT CASE WHEN $2 THEN ($1::date::timestamp AT TIME ZONE 'Europe/Oslo')-interval '1 millisecond' ELSE now() END AS at",
          [today, quantity === 28],
        )
      ).rows[0].at;
      const sale = (
        await db.pool.query(
          "INSERT INTO sales(store_id,device_id,employee_id,shift_id,request_id,request_hash,receipt_number,total,tax,discount,receipt,created_at) VALUES($1,$2,$3,$4,gen_random_uuid(),'fixture',$5,$6,0,0,'{}',$7) RETURNING id",
          [
            actor.store,
            actor.device,
            actor.employee,
            shift,
            'D-' + quantity,
            quantity * 10,
            timestamp,
          ],
        )
      ).rows[0].id;
      await db.pool.query(
        'INSERT INTO sale_items(store_id,sale_id,product_id,quantity,price,cost,tax_rate,total,cost_total) VALUES($1,$2,$3,$4,10,5,0,$5,$6)',
        [actor.store, sale, productId, quantity, quantity * 10, quantity * 5],
      );
    }
    const report = await new ReplenishmentService(db).report(req, {});
    const tool = (await executeAiTool(db, req, 'replenishment', {
      historyDays: 28,
      reviewDays: 7,
      safetyDays: 2,
      search: '',
      status: 'all',
      page: 1,
    })) as typeof report;
    expect(tool.rows).toEqual(report.rows);
    const milk = report.rows.find((r: any) => r.productId === productId);
    expect(milk).toMatchObject({
      sold: '28.000',
      observedDays: 28,
      available: '3.000',
      expired: '2.000',
      quantity: '12.000',
      status: 'order_now',
      dailySales: '1.000',
    });
    expect(report.rows.find((r: any) => r.sku === 'NO-SALES')).toMatchObject({
      demandStatus: 'no_sales',
      quantity: '0.000',
    });
    expect(report.rows.find((r: any) => r.sku === 'NEW')).toMatchObject({
      demandStatus: 'insufficient_history',
      quantity: null,
    });
  });
  it('does not turn overdue incoming stock into a confident quantity', async () => {
    const supplier = (
      await db.pool.query('SELECT id FROM suppliers WHERE store_id=$1', [req.context.store.id])
    ).rows[0].id;
    const purchase = (
      await db.pool.query(
        "INSERT INTO purchases(store_id,supplier_id,number,status,expected_date,created_by,device_id,subtotal,tax,total) SELECT $1,$2,'PO-DUE','ordered',(now() AT TIME ZONE 'Europe/Oslo')::date-1,e.id,d.id,50,0,50 FROM employees e JOIN devices d ON d.store_id=e.store_id WHERE e.store_id=$1 LIMIT 1 RETURNING id",
        [req.context.store.id, supplier],
      )
    ).rows[0].id;
    await db.pool.query(
      "INSERT INTO purchase_lines(store_id,purchase_id,product_id,product_name,sku,unit,ordered_quantity,unit_cost,tax_rate,subtotal,tax,total) VALUES($1,$2,$3,'Demand milk','DEMAND','piece',10,5,0,50,0,50)",
      [req.context.store.id, purchase, productId],
    );
    const report = await new ReplenishmentService(db).report(req, { productId });
    expect(report.rows[0]).toMatchObject({ status: 'needs_review', quantity: null });
    expect(report.rows[0].warnings).toContain('uncertain_incoming');
  });
  it('enforces authentication, all read permissions, store isolation and input bounds', async () => {
    expect((await fetch(url + '/api/reports/replenishment')).status).toBe(401);
    const response = await fetch(url + '/api/reports/replenishment?status=no_sales', {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).rows).toHaveLength(1);
    expect(
      (
        await fetch(url + '/api/reports/replenishment?historyDays=0', {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(400);
    const service = new ReplenishmentService(db);
    await expect(
      service.report(
        { ...req, context: { ...req.context, user: { permissions: ['inventory.read'] } } },
        {},
      ),
    ).rejects.toThrow();
    expect(
      (
        await service.report(
          {
            ...req,
            context: { ...req.context, store: { ...req.context.store, id: crypto.randomUUID() } },
          },
          {},
        )
      ).rows,
    ).toEqual([]);
  });
});
