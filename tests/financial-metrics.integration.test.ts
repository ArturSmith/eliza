import { OwnerDashboardController } from '../apps/api/dist/owner-dashboard.js';
import { InventoryController } from '../apps/api/dist/inventory.js';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
import { FinancialMetricsService } from '../apps/api/dist/financial-metrics.js';

const admin = new Database();
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_financial_test_${Date.now()}`;
let db: Database, app: Awaited<ReturnType<typeof createApp>>, url: string;

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE ${name}`);
  const target = new URL(original);
  target.pathname = `/${name}`;
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

describe('canonical store financial summary', () => {
  it('reconciles discounted sales, partial refunds, losses and allocated expenses in store time', async () => {
    const setup = await fetch(url + '/api/auth/setup', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        'X-Eliza-Request': '1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        storeName: 'Financial test',
        ownerName: 'Owner',
        email: 'owner@financial.test',
        password: 'owner-password-12345',
        currency: 'NOK',
        timezone: 'Europe/Oslo',
      }),
    });
    expect(setup.status).toBe(201);
    const {
      rows: [actor],
    } = await db.pool.query(
      'SELECT s.id AS store,e.id AS employee,d.id AS device FROM stores s JOIN employees e ON e.store_id=s.id JOIN devices d ON d.store_id=s.id LIMIT 1',
    );
    const product = (
      await db.pool.query(
        "INSERT INTO products(store_id,name,sku,category,unit,price,cost,min_stock) VALUES($1,'Yogurt','YOG','Dairy','piece',100,60,0) RETURNING id",
        [actor.store],
      )
    ).rows[0].id;
    const shift = (
      await db.pool.query(
        "INSERT INTO shifts(store_id,device_id,employee_id,opening_cash,request_id,request_hash) VALUES($1,$2,$3,0,$4,'test') RETURNING id",
        [actor.store, actor.device, actor.employee, crypto.randomUUID()],
      )
    ).rows[0].id;
    const sale = (
      await db.pool.query(
        "INSERT INTO sales(store_id,device_id,employee_id,shift_id,request_id,request_hash,receipt_number,total,tax,discount,receipt,created_at) VALUES($1,$2,$3,$4,$5,'test','TEST-1',80,0,20,'{}','2026-09-30T22:30:00Z') RETURNING id",
        [actor.store, actor.device, actor.employee, shift, crypto.randomUUID()],
      )
    ).rows[0].id;
    await db.pool.query(
      'INSERT INTO sale_items(store_id,sale_id,product_id,quantity,price,cost,tax_rate,total,cost_total) VALUES($1,$2,$3,1,80,60,0,80,60)',
      [actor.store, sale, product],
    );
    const refund = (
      await db.pool.query(
        "INSERT INTO refunds(store_id,sale_id,shift_id,employee_id,device_id,approver_id,request_id,request_hash,number,method,reason,total,tax,receipt,created_at) VALUES($1,$2,$3,$4,$5,$4,$6,'test','RF-TEST','cash','return',20,0,'{}','2026-10-01T12:00:00Z') RETURNING id",
        [actor.store, sale, shift, actor.employee, actor.device, crypto.randomUUID()],
      )
    ).rows[0].id;
    await db.pool.query(
      'INSERT INTO refund_lines(store_id,refund_id,sale_id,product_id,quantity,restock,total,tax,restored_cost) VALUES($1,$2,$3,$4,0.25,true,20,0,15)',
      [actor.store, refund, sale, product],
    );
    await db.pool.query(
      "INSERT INTO movements(store_id,product_id,employee_id,device_id,quantity,balance,reason,notes,request_id,request_hash,created_at,cost_total) VALUES($1,$2,$3,$4,-1,0,'expired','test',$5,'test','2026-10-01T14:00:00Z',7)",
      [actor.store, product, actor.employee, actor.device, crypto.randomUUID()],
    );
    await db.pool.query(
      "INSERT INTO expenses(store_id,expense_date,description,category,amount,payment_method,allocation_method,period_start,period_end,payment_date) VALUES($1,'2026-09-30','Rent','Rent',3100,'bank','EVEN_OVER_PERIOD','2026-10-01','2026-10-31','2026-09-30')",
      [actor.store],
    );
    const metrics = new FinancialMetricsService(db);
    const result = await metrics.getFinancialSummary(actor.store, {
      from: '2026-10-01',
      to: '2026-10-01',
      timezone: 'Europe/Oslo',
    });
    expect(result.revenue).toBe('60.00');
    expect(result.cogs).toBe('45.00');
    expect(result.grossProfit).toBe('15.00');
    expect(result.grossMarginPercent).toBe('25.00');
    expect(result.inventoryLosses).toBe('7.00');
    expect(result.operatingExpenses).toBe('100.00');
    expect(result.storeOperatingProfit).toBe('-92.00');
    expect(result.dataQuality.costComplete).toBe(true);
    expect(result.breakdown.expensesByCategory).toEqual({ Rent: '100.00' });
    const damagedRefund = (
      await db.pool.query(
        "INSERT INTO refunds(store_id,sale_id,shift_id,employee_id,device_id,approver_id,request_id,request_hash,number,method,reason,total,tax,receipt,created_at) VALUES($1,$2,$3,$4,$5,$4,$6,'test','RF-DAMAGED','cash','damaged',20,0,'{}','2026-10-01T15:00:00Z') RETURNING id",
        [actor.store, sale, shift, actor.employee, actor.device, crypto.randomUUID()],
      )
    ).rows[0].id;
    await db.pool.query(
      'INSERT INTO refund_lines(store_id,refund_id,sale_id,product_id,quantity,restock,total,tax,restored_cost,loss_cost) VALUES($1,$2,$3,$4,0.25,false,20,0,15,15)',
      [actor.store, damagedRefund, sale, product],
    );
    const afterDamage = await metrics.getFinancialSummary(actor.store, {
      from: '2026-10-01',
      to: '2026-10-01',
      timezone: 'Europe/Oslo',
    });
    expect(afterDamage.revenue).toBe('40.00');
    expect(afterDamage.cogs).toBe('30.00');
    expect(afterDamage.grossProfit).toBe('10.00');
    expect(afterDamage.inventoryLosses).toBe('22.00');
    expect(afterDamage.storeOperatingProfit).toBe('-112.00');
    const previous = await metrics.getFinancialSummary(actor.store, {
      from: '2026-09-30',
      to: '2026-09-30',
      timezone: 'Europe/Oslo',
    });
    expect(previous.revenue).toBe('0.00');
    const legacyBatch = (
      await db.pool.query(
        "INSERT INTO stock_batches(store_id,product_id,expiry_date,quantity,unit_cost,cost_source) VALUES($1,$2,'2026-12-02',1,60,'legacy_estimate') RETURNING id",
        [actor.store, product],
      )
    ).rows[0].id;
    const legacySale = (
      await db.pool.query(
        "INSERT INTO sales(store_id,device_id,employee_id,shift_id,request_id,request_hash,receipt_number,total,tax,discount,receipt,created_at) VALUES($1,$2,$3,$4,$5,'test','TEST-LEGACY',100,0,0,jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('productId',(SELECT id::text FROM products WHERE store_id=$1 AND sku='YOG'),'category','Dairy','quantity','1','total','100.00'))),'2026-10-02T10:00:00Z') RETURNING id",
        [actor.store, actor.device, actor.employee, shift, crypto.randomUUID()],
      )
    ).rows[0].id;
    const legacyItem = (
      await db.pool.query(
        'INSERT INTO sale_items(store_id,sale_id,product_id,quantity,price,cost,tax_rate,total,cost_total) VALUES($1,$2,$3,1,100,60,0,100,60) RETURNING id',
        [actor.store, legacySale, product],
      )
    ).rows[0].id;
    await db.pool.query(
      'INSERT INTO sale_batch_allocations(store_id,sale_item_id,batch_id,quantity,unit_cost,cost_total) VALUES($1,$2,$3,1,60,60)',
      [actor.store, legacyItem, legacyBatch],
    );
    const legacyRefund = (
      await db.pool.query(
        "INSERT INTO refunds(store_id,sale_id,shift_id,employee_id,device_id,approver_id,request_id,request_hash,number,method,reason,total,tax,receipt,created_at) VALUES($1,$2,$3,$4,$5,$4,$6,'test','RF-LEGACY','cash','partial',20,0,'{}','2026-10-02T11:00:00Z') RETURNING id",
        [actor.store, legacySale, shift, actor.employee, actor.device, crypto.randomUUID()],
      )
    ).rows[0].id;
    await db.pool.query(
      'INSERT INTO refund_lines(store_id,refund_id,sale_id,sale_item_id,product_id,quantity,restock,total,tax,restored_cost) VALUES($1,$2,$3,$4,$5,0.2,true,20,0,12)',
      [actor.store, legacyRefund, legacySale, legacyItem, product],
    );
    const provisional = await metrics.getFinancialSummary(actor.store, {
      from: '2026-10-02',
      to: '2026-10-02',
      timezone: 'Europe/Oslo',
    });
    expect(provisional.revenue).toBe('80.00');
    expect(provisional.cogs).toBeNull();
    expect(provisional.grossProfit).toBeNull();
    expect(provisional.estimated).toEqual({
      cogs: '48.00',
      grossProfit: '32.00',
      grossMarginPercent: '40.00',
      storeOperatingProfit: '-68.00',
    });
    expect(provisional.dataQuality).toMatchObject({
      estimatedCostSaleItems: 1,
      estimatedCostRefundLines: 1,
      missingSnapshotSaleItems: 0,
      missingSnapshotRefundLines: 0,
    });
    await db.pool.query(
      "INSERT INTO stock_batches(store_id,product_id,expiry_date,quantity,unit_cost,cost_source) VALUES($1,$2,'2026-12-01',2,4,'adjustment')",
      [actor.store, product],
    );
    await db.pool.query('UPDATE products SET cost=999 WHERE id=$1', [product]);
    const consumed = await db.pool.query(
      'SELECT consume_adjustment_batches_costed($1::uuid,$2::uuid,1) AS cost',
      [actor.store, product],
    );
    expect(consumed.rows[0].cost).toBe('4.00');
    // Dashboard dimensions must never present estimated batch cost as verified profit.
    const dashboard = new OwnerDashboardController(db, metrics) as any;
    const store = { id: actor.store, timezone: 'Europe/Oslo', currency: 'NOK' };
    const category = await dashboard.categories(
      store,
      { from: '2026-10-02', to: '2026-10-02' },
      null,
      true,
    );
    expect(category.rows[0].grossProfit).toBeNull();
    expect(category.rows[0].margin).toBeNull();
    const trend = await dashboard.marginTrend(store, '2026-10-02');
    expect(trend.find((r: any) => r.month === '2026-10').margin).toBeNull();
    // A refund header without line facts is incomplete, not a verified zero-cost return.
    await db.pool.query(
      "INSERT INTO refunds(store_id,sale_id,shift_id,employee_id,device_id,approver_id,request_id,request_hash,number,method,reason,total,tax,receipt,created_at) VALUES($1,$2,$3,$4,$5,$4,$6,'audit','RF-NOLINES','cash','audit',10,0,'{}','2026-10-03T12:00:00Z')",
      [actor.store, sale, shift, actor.employee, actor.device, crypto.randomUUID()],
    );
    const incomplete = await metrics.getFinancialSummary(actor.store, {
      from: '2026-10-03',
      to: '2026-10-03',
      timezone: 'Europe/Oslo',
    });
    expect(incomplete.revenue).toBe('-10.00');
    expect(incomplete.cogs).toBeNull();
    expect(incomplete.estimated).toBeNull();
    expect(incomplete.dataQuality.missingCostRefundLines).toBe(1);
    // Search all history, not just the first 100. Dates are store-local; UUID breaks ties.
    await db.pool.query(
      "INSERT INTO movements(store_id,product_id,employee_id,device_id,quantity,balance,reason,notes,request_id,request_hash,created_at) SELECT $1,$2,$3,$4,1,n,'received','audit-history-'||n,gen_random_uuid(),'history','2026-09-09T22:30:00Z' FROM generate_series(1,105) n",
      [actor.store, product, actor.employee, actor.device],
    );
    const inventory = new InventoryController(db);
    const req = { context: { store, user: { permissions: ['inventory.read'] } } } as any;
    const filters = {
      search: 'audit-history-',
      productId: product,
      from: '2026-09-10',
      to: '2026-09-10',
    };
    const first = await inventory.history({ ...filters, page: 1 }, req);
    const second = await inventory.history({ ...filters, page: 2 }, req);
    const third = await inventory.history({ ...filters, page: 3 }, req);
    const cookie = setup.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    const historyUrl = url + '/api/inventory/movements/history?search=audit-history-';
    expect((await fetch(historyUrl)).status).toBe(401);
    const authenticatedHistory = await fetch(historyUrl, { headers: { Cookie: cookie } });
    expect(authenticatedHistory.status).toBe(200);
    expect((await authenticatedHistory.json()).total).toBe(105);
    expect((await fetch(historyUrl + '&page=0', { headers: { Cookie: cookie } })).status).toBe(400);
    expect(first.total).toBe(105);
    expect(first.rows).toHaveLength(50);
    expect(second.rows).toHaveLength(50);
    expect(third.rows).toHaveLength(5);
    expect(new Set([...first.rows, ...second.rows, ...third.rows].map((r: any) => r.id)).size).toBe(
      105,
    );
    expect((await inventory.history({ ...filters, page: 4 }, req)).total).toBe(105);
    expect((await inventory.history({ ...filters, page: 4 }, req)).rows).toEqual([]);
    expect(
      (await inventory.history({ ...filters, from: '2026-09-09', to: '2026-09-09' }, req)).total,
    ).toBe(0);
    expect((await inventory.history({ search: '%' }, req)).total).toBe(0);
    expect(
      (
        await inventory.history({}, {
          context: { store: { ...store, id: crypto.randomUUID() } },
        } as any)
      ).total,
    ).toBe(0);
    await expect(
      inventory.history({ from: '2026-10-01', to: '2026-09-01' }, req),
    ).rejects.toThrow();
    await expect(inventory.history({ page: 0 }, req)).rejects.toThrow();
  });
});
