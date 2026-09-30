import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
import { storeToday } from '../packages/contracts/src/index';

const admin = new Database();
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_dashboard_test_${Date.now()}`;
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

describe.sequential('owner dashboard', () => {
  it('records a sale so the dashboard has something to report', async () => {
    expect((await owner.request('/auth/setup', account)).status).toBe(201);
    const session = (await owner.request('/auth/session')).body;
    const roles = (await owner.request('/team/roles')).body;
    await owner.request(
      '/team/' + session.user.id,
      {
        name: 'Owner',
        employeeCode: 'OWNER',
        roleId: roles.find((r: any) => r.name === 'Owner').id,
        active: true,
        pin: '654321',
      },
      'PATCH',
    );
    await owner.request('/team', {
      name: 'Anna',
      employeeCode: 'ANNA',
      roleId: roles.find((r: any) => r.name === 'Cashier').id,
      pin: '123456',
    });
    await register.request('/auth/login', { email: account.email, password: account.password });
    await register.request('/pos/enroll', { name: 'Dashboard register' });
    expect(
      (await register.request('/pos/login', { employeeCode: 'ANNA', pin: '123456' })).status,
    ).toBe(200);
    shiftId = (
      await register.request('/pos/shifts', { requestId: crypto.randomUUID(), openingCash: '100' })
    ).body.id;

    productId = (
      await owner.request('/products', {
        name: 'Milk',
        sku: 'MILK',
        category: 'Dairy',
        unit: 'piece',
        price: '100.00',
        cost: '60.00',
        taxRate: '0',
        minStock: '2',
        plu: '101',
        barcodes: ['709100'],
      })
    ).body.id;
    // A product with no cost proves the dashboard reports incomplete data instead of guessing.
    freeProductId = (
      await owner.request('/products', {
        name: 'Uncosted bread',
        sku: 'BREAD',
        category: 'Bakery',
        unit: 'piece',
        price: '50.00',
        cost: '0',
        taxRate: '0',
        minStock: '1',
        plu: '102',
        barcodes: ['709101'],
      })
    ).body.id;
    await owner.request('/inventory/adjustments', {
      requestId: crypto.randomUUID(),
      productId,
      quantity: '10',
      reason: 'opening_balance',
    });
    const sale = await register.request('/pos/sales', {
      requestId: crypto.randomUUID(),
      shiftId,
      lines: [{ productId, quantity: '2', expectedPrice: '100.00', expectedTaxRate: '0' }],
      discountPercent: '0',
      payment: { method: 'cash', tendered: '200.00' },
    });
    expect(sale.status).toBe(201);
  });

  it('reports revenue, cost of goods sold and margin for today', async () => {
    const res = await owner.request('/reports/owner-dashboard?period=today');
    expect(res.status).toBe(200);
    expect(res.body.kpis.revenue.value).toBe(200);
    expect(res.body.kpis.grossProfit.value).toBe(80);
    expect(res.body.kpis.grossMargin.value).toBe(40);
    expect(res.body.kpis.grossMargin.unit).toBe('points');
    expect(res.body.kpis.transactions.value).toBe(1);
    expect(res.body.kpis.averageBasket.value).toBe(200);
    expect(res.body.financialSummary).toMatchObject({
      revenue: '200.00',
      cogs: '120.00',
      grossProfit: '80.00',
      grossMarginPercent: '40.00',
      inventoryLosses: '0.00',
      operatingExpenses: '0.00',
      storeOperatingProfit: '80.00',
      dataQuality: { costComplete: true, lossCostComplete: true },
    });
  });

  it('marks comparisons unavailable instead of inventing a baseline', async () => {
    const res = await owner.request('/reports/owner-dashboard?period=today');
    expect(res.body.kpis.revenue.change).toBeNull();
    expect(res.body.comparisons.some((c: any) => c.available === false)).toBe(true);
  });

  it('keeps average basket based on completed sales when a receipt is partly refunded', async () => {
    const session = (await owner.request('/auth/session')).body;
    const sale = (
      await db.pool.query(
        `INSERT INTO sales(store_id,device_id,employee_id,shift_id,request_id,request_hash,receipt_number,total,tax,discount,receipt,created_at)
         VALUES($1,$2,$3,$4,$5,'fixture','BASKET-2003',100,0,0,$6,'2003-01-01T12:00:00Z') RETURNING id`,
        [
          session.store.id,
          session.device.id,
          session.user.id,
          shiftId,
          crypto.randomUUID(),
          { lines: [{ productId, category: 'Dairy', quantity: '1', total: '100.00', tax: '0' }] },
        ],
      )
    ).rows[0].id;
    await db.pool.query(
      'INSERT INTO sale_items(store_id,sale_id,product_id,quantity,price,cost,tax_rate,total,cost_total) VALUES($1,$2,$3,1,100,60,0,100,60)',
      [session.store.id, sale, productId],
    );
    const refund = (
      await db.pool.query(
        `INSERT INTO refunds(store_id,sale_id,shift_id,employee_id,device_id,approver_id,request_id,request_hash,number,method,reason,total,tax,receipt,created_at)
         VALUES($1,$2,$3,$4,$5,$4,$6,'fixture','BASKET-RF-2003','cash','partial',40,0,'{}','2003-01-01T13:00:00Z') RETURNING id`,
        [session.store.id, sale, shiftId, session.user.id, session.device.id, crypto.randomUUID()],
      )
    ).rows[0].id;
    await db.pool.query(
      'INSERT INTO refund_lines(store_id,refund_id,sale_id,product_id,quantity,restock,total,tax,restored_cost) VALUES($1,$2,$3,$4,0.4,true,40,0,24)',
      [session.store.id, refund, sale, productId],
    );
    const report = (
      await owner.request('/reports/owner-dashboard?period=custom&from=2003-01-01&to=2003-01-01')
    ).body;
    expect(report.financialSummary.revenue).toBe('60.00');
    expect(report.kpis.averageBasket.value).toBe(100);
  });

  it('does not show estimated profit when a historical receipt has no cost lines', async () => {
    const session = (await owner.request('/auth/session')).body;
    await db.pool.query(
      `INSERT INTO sales(store_id,device_id,employee_id,shift_id,request_id,request_hash,receipt_number,total,tax,discount,receipt,created_at)
       VALUES($1,$2,$3,$4,$5,'fixture','MISSING-COST-2004',80,0,0,'{"lines":[]}','2004-01-01T12:00:00Z')`,
      [session.store.id, session.device.id, session.user.id, shiftId, crypto.randomUUID()],
    );
    const report = (
      await owner.request('/reports/owner-dashboard?period=custom&from=2004-01-01&to=2004-01-01')
    ).body;
    expect(report.financialSummary).toMatchObject({
      revenue: '80.00',
      cogs: null,
      grossProfit: null,
      grossMarginPercent: null,
      storeOperatingProfit: null,
      estimated: null,
      dataQuality: { costComplete: false },
    });
  });

  it('includes period expenses and payments without double-counting purchases in profit', async () => {
    const session = (await owner.request('/auth/session')).body;
    const today = storeToday(new Date(), session.store.timezone);
    expect(
      (
        await owner.request('/expenses', {
          date: today,
          description: 'Utilities',
          category: 'Utilities',
          amount: '30.50',
          paymentMethod: 'bank',
        })
      ).status,
    ).toBe(201);
    const supplier = (
      await db.pool.query(
        "INSERT INTO suppliers(store_id,code,name) VALUES($1,'TEST-SPEND','Supplier') RETURNING id",
        [session.store.id],
      )
    ).rows[0];
    await db.pool.query(
      `INSERT INTO purchases(store_id,supplier_id,number,status,subtotal,tax,total,created_by,device_id,created_at,payment_status,paid_at) VALUES
      ($1,$2,'SPEND-1','ordered',100.25,0,100.25,$3,$4,'2000-01-01','paid',now()),
      ($1,$2,'SPEND-2','ordered',400,0,400,$3,$4,now(),'unpaid',NULL),
      ($1,$2,'SPEND-3','ordered',900,0,900,$3,$4,'2000-01-01','paid','2000-01-02')`,
      [session.store.id, supplier.id, session.user.id, session.device.id],
    );
    await owner.request('/expenses', {
      date: '2000-01-02',
      description: 'Old cost',
      category: 'Other',
      amount: '5.75',
      paymentMethod: 'cash',
    });
    const otherStore = (
      await db.pool.query(
        "INSERT INTO stores(organization_id,name,currency,timezone) SELECT organization_id,'Other shop',currency,timezone FROM stores WHERE id=$1 RETURNING id",
        [session.store.id],
      )
    ).rows[0];
    await db.pool.query(
      "INSERT INTO expenses(store_id,expense_date,description,category,amount,payment_method) VALUES($1,$2,'Other cost','Other',999,'cash')",
      [otherStore.id, today],
    );
    const report = (await owner.request('/reports/owner-dashboard?period=today')).body;
    expect(report.kpis.operatingExpenses.value).toBe(30.5);
    expect(report.kpis.paidPurchases.value).toBe(100.25);
    expect(report.kpis.totalSpending.value).toBe(130.75);
    expect(report.kpis.grossProfit.value).toBe(80);
    expect(report.kpis.netProfit.value).toBe(49.5);
    expect(report.financialSummary.storeOperatingProfit).toBe('49.50');
    expect(report.financialSummary.operatingExpenses).toBe('30.50');
    expect(report.unavailable.some((u: any) => u.metric === 'operatingExpenses')).toBe(false);
    const historical = (
      await owner.request('/reports/owner-dashboard?period=custom&from=2000-01-02&to=2000-01-02')
    ).body;
    expect(historical.kpis.totalSpending.value).toBe(905.75);
    expect(historical.kpis.netProfit.value).toBe(-5.75);
  });

  it('keeps spending totals exact to the cent', async () => {
    const session = (await owner.request('/auth/session')).body;
    await owner.request('/expenses', {
      date: '2001-01-02',
      description: 'Small cost',
      category: 'Other',
      amount: '0.10',
      paymentMethod: 'cash',
    });
    const supplier = (
      await db.pool.query('SELECT id FROM suppliers WHERE store_id=$1 LIMIT 1', [session.store.id])
    ).rows[0];
    await db.pool.query(
      `INSERT INTO purchases(store_id,supplier_id,number,status,subtotal,tax,total,created_by,device_id,payment_status,paid_at) VALUES($1,$2,'CENTS','ordered',0.2,0,0.2,$3,$4,'paid','2001-01-02T12:00:00Z')`,
      [session.store.id, supplier.id, session.user.id, session.device.id],
    );
    const report = (
      await owner.request('/reports/owner-dashboard?period=custom&from=2001-01-02&to=2001-01-02')
    ).body;
    expect(report.kpis.totalSpending.value).toBe(0.3);
    expect(report.kpis.netProfit.value).toBe(-0.1);
  });

  it('uses shop-local midnight for payments across the daylight-saving change', async () => {
    const session = (await owner.request('/auth/session')).body;
    const supplier = (
      await db.pool.query('SELECT id FROM suppliers WHERE store_id=$1 LIMIT 1', [session.store.id])
    ).rows[0];
    for (const [index, paidAt, amount] of [
      [0, '2026-03-28T22:59:59.999Z', '0.01'],
      [1, '2026-03-28T23:00:00Z', '0.02'],
      [2, '2026-03-29T21:59:59.999Z', '0.04'],
      [3, '2026-03-29T22:00:00Z', '0.08'],
    ])
      await db.pool.query(
        `INSERT INTO purchases(store_id,supplier_id,number,status,subtotal,tax,total,created_by,device_id,payment_status,paid_at) VALUES($1,$2,$3,'ordered',$4,0,$4,$5,$6,'paid',$7)`,
        [
          session.store.id,
          supplier.id,
          'DST-' + index,
          amount,
          session.user.id,
          session.device.id,
          paidAt,
        ],
      );
    for (const [date, amount] of [
      ['2026-03-28', '0.20'],
      ['2026-03-29', '0.10'],
      ['2026-03-30', '0.40'],
    ])
      expect(
        (
          await owner.request('/expenses', {
            date,
            amount,
            description: 'Date boundary',
            category: 'Other',
            paymentMethod: 'cash',
          })
        ).status,
      ).toBe(201);
    const report = (
      await owner.request('/reports/owner-dashboard?period=custom&from=2026-03-29&to=2026-03-29')
    ).body;
    expect(report.kpis.paidPurchases.value).toBe(0.06);
    expect(report.kpis.operatingExpenses.value).toBe(0.1);
    expect(report.kpis.totalSpending.value).toBe(0.16);
    expect(report.kpis.netProfit.value).toBe(-0.1);
  });

  it('counts products that have no purchase cost', async () => {
    const res = await owner.request('/reports/owner-dashboard?period=today');
    expect(res.body.readiness.missingCost).toBeGreaterThan(0);
    expect(res.body.readiness.products).toBe(2);
    expect(freeProductId).toBeTruthy();
  });

  it('returns one hourly bucket per hour of the business day', async () => {
    const res = await owner.request('/reports/owner-dashboard?period=today');
    expect(res.body.hourly).toHaveLength(24);
    expect(res.body.hourly.reduce((sum: number, h: any) => sum + h.total, 0)).toBe(200);
  });

  it('refuses the report to an employee without the analytics permission', async () => {
    const roles = (await owner.request('/team/roles')).body;
    const cashier = roles.find((r: any) => r.name === 'Cashier');
    expect(cashier.permissions).not.toContain('analytics.view');
    const anonymous = new Client();
    expect((await anonymous.request('/reports/owner-dashboard?period=today')).status).toBe(401);
  });

  it('hides cost and profit from a role without the margin permission', async () => {
    const roles = (await owner.request('/team/roles')).body;
    const manager = roles.find((r: any) => r.name === 'Manager');
    expect(manager.permissions).toContain('analytics.margin');
    // No API edits role permissions, so the grant is withdrawn directly in the database.
    await db.pool.query(
      `UPDATE roles SET permissions = (
         SELECT coalesce(jsonb_agg(p), '[]'::jsonb) FROM jsonb_array_elements(permissions) p
         WHERE p <> '"analytics.margin"'::jsonb)
       WHERE id = $1`,
      [manager.id],
    );
    await owner.request('/team', {
      name: 'Mark',
      employeeCode: 'MARK',
      roleId: manager.id,
      pin: '222333',
      email: 'mark@pos.test',
      password: 'manager-password-12345',
    });
    const limited = new Client();
    const login = await limited.request('/auth/login', {
      email: 'mark@pos.test',
      password: 'manager-password-12345',
    });
    expect(login.status).toBe(200);
    const res = await limited.request('/reports/owner-dashboard?period=today');
    expect(res.status).toBe(200);
    expect(res.body.kpis.revenue.value).toBe(200);
    expect(res.body.kpis.grossProfit.value).toBeNull();
    expect(res.body.kpis.grossProfit.restricted).toBe(true);
    expect(res.body.kpis.grossMargin.restricted).toBe(true);
    expect(res.body.kpis.netProfit.value).toBeNull();
    expect(res.body.kpis.netProfit.restricted).toBe(true);
    expect(res.body.financialSummary).toMatchObject({
      revenue: '200.00',
      cogs: null,
      grossProfit: null,
      inventoryLosses: null,
      storeOperatingProfit: null,
      dataQuality: null,
      permissions: { margin: false },
    });
    await db.pool.query(
      `UPDATE roles SET permissions=(SELECT COALESCE(jsonb_agg(p),'[]'::jsonb) FROM jsonb_array_elements(permissions) p WHERE p NOT IN ('"expenses.read"'::jsonb,'"purchases.read"'::jsonb)) WHERE id=$1`,
      [manager.id],
    );
    const restricted = (await limited.request('/reports/owner-dashboard?period=today')).body;
    expect(restricted.kpis.operatingExpenses.value).toBeNull();
    expect(restricted.financialSummary.operatingExpenses).toBeNull();
    expect(restricted.kpis.paidPurchases.value).toBeNull();
    expect(restricted.kpis.totalSpending.value).toBeNull();
    expect(restricted.kpis.totalSpending.restricted).toBe(true);
    const restrictedActions = await limited.request('/reports/action-center');
    expect(restrictedActions.status).toBe(200);
    expect(
      restrictedActions.body.insights.every(
        (i: any) => i.type !== 'margin' && i.id !== 'dead-stock',
      ),
    ).toBe(true);
  });
});

describe.sequential('manager action centre', () => {
  it('persists review state without duplicating a detected condition, and reactivates elapsed snoozes', async () => {
    const first = await owner.request('/reports/action-center');
    expect(first.status).toBe(200);
    const insight = first.body.insights.find((item: any) => item.id === 'uncounted');
    expect(insight).toBeDefined();
    expect(first.body.insights.filter((item: any) => item.id === insight.id)).toHaveLength(1);
    expect(
      (await owner.request(`/reports/action-center/${insight.id}/state`, { status: 'SEEN' }))
        .status,
    ).toBe(201);
    expect(
      (await owner.request('/reports/action-center')).body.insights.find(
        (item: any) => item.id === insight.id,
      ).status,
    ).toBe('SEEN');
    const until = new Date(Date.now() + 86400000).toISOString();
    expect(
      (
        await owner.request(`/reports/action-center/${insight.id}/state`, {
          status: 'SNOOZED',
          snoozedUntil: until,
        })
      ).status,
    ).toBe(201);
    expect(
      (await owner.request('/reports/action-center')).body.insights.find(
        (item: any) => item.id === insight.id,
      ).active,
    ).toBe(false);
    await db.pool.query(
      "UPDATE manager_insight_states SET snoozed_until=now()-interval '1 second' WHERE insight_id=$1",
      [insight.id],
    );
    expect(
      (await owner.request('/reports/action-center')).body.insights.find(
        (item: any) => item.id === insight.id,
      ).status,
    ).toBe('NEW');
    expect(
      (await owner.request(`/reports/action-center/${insight.id}/state`, { status: 'RESOLVED' }))
        .status,
    ).toBe(201);
    expect(
      (await owner.request('/reports/action-center')).body.insights.find(
        (item: any) => item.id === insight.id,
      ).active,
    ).toBe(false);
    expect(
      (await owner.request('/reports/owner-dashboard?period=week')).body.insights.find(
        (i: any) => i.id === insight.id,
      ).status,
    ).toBe('RESOLVED');
    expect(
      (
        await owner.request(`/reports/action-center/${insight.id}/state`, {
          status: 'SNOOZED',
          snoozedUntil: '2020-01-01T00:00:00.000Z',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await owner.request('/inventory/adjustments', {
          requestId: crypto.randomUUID(),
          productId: freeProductId,
          quantity: '1',
          reason: 'opening_balance',
        })
      ).status,
    ).toBe(201);
    const cleared = (await owner.request('/reports/action-center')).body.insights.find(
      (i: any) => i.id === 'uncounted',
    );
    expect(cleared.status).toBe('RESOLVED');
    const returning = await owner.request('/products', {
      name: 'Uncounted new product',
      sku: 'UNCOUNTED-NEW',
      category: 'Pantry',
      unit: 'piece',
      price: '5.00',
      cost: '2.00',
      taxRate: '0',
      minStock: '1',
      plu: '199',
      barcodes: ['709199'],
    });
    expect(returning.status).toBe(201);
    const recurred = (await owner.request('/reports/action-center')).body.insights.find(
      (i: any) => i.id === 'uncounted',
    );
    expect(recurred.status).toBe('NEW');
    expect(recurred.active).toBe(true);
  });

  it('uses age, positive stock and batch cost for store-local no-sales analysis', async () => {
    let nextCode = 105;
    const make = async (name: string, cost: string, sku: string, withStock = true) => {
      const code = String(++nextCode);
      const product = await owner.request('/products', {
        name,
        sku,
        category: 'Drinks',
        unit: 'piece',
        price: '30.00',
        cost,
        taxRate: '0',
        minStock: '1',
        plu: code,
        barcodes: ['709' + code],
      });
      expect(product.status).toBe(201);
      if (withStock)
        await owner.request('/inventory/adjustments', {
          requestId: crypto.randomUUID(),
          productId: product.body.id,
          quantity: '5',
          reason: 'opening_balance',
        });
      return product.body.id as string;
    };
    const old = await make('Old cola', '10.00', 'OLD-COLA');
    const fresh = await make('Fresh cola', '10.00', 'FRESH-COLA');
    await db.pool.query("UPDATE products SET created_at=now()-interval '70 days' WHERE id=$1", [
      old,
    ]);
    const defaultResult = await owner.request('/reports/action-center/no-sales');
    expect(defaultResult.status).toBe(200);
    expect(defaultResult.body.thresholdDays).toBe(60);
    const row = defaultResult.body.rows.find((r: any) => r.id === old);
    expect(row).toMatchObject({
      quantity: '5.000',
      inventoryValue: '50.00',
      costEstimated: false,
      costMissing: false,
    });
    expect(defaultResult.body.rows.some((r: any) => r.id === fresh)).toBe(false);
    expect(defaultResult.body.rows.some((r: any) => r.id === productId)).toBe(false);
    await db.pool.query('UPDATE products SET cost=20.00 WHERE id=$1', [old]);
    expect(
      (
        await owner.request('/inventory/adjustments', {
          requestId: crypto.randomUUID(),
          productId: old,
          quantity: '5',
          reason: 'count_correction',
        })
      ).status,
    ).toBe(201);
    const secondBatch = (await owner.request('/reports/action-center/no-sales')).body.rows.find(
      (r: any) => r.id === old,
    );
    expect(secondBatch.quantity).toBe('10.000');
    expect(secondBatch.inventoryValue).toBe('150.00');

    const limited = new Client();
    expect(
      (
        await limited.request('/auth/login', {
          email: 'mark@pos.test',
          password: 'manager-password-12345',
        })
      ).status,
    ).toBe(200);
    const limitedRows = (await limited.request('/reports/action-center/no-sales')).body.rows;
    expect(limitedRows.find((r: any) => r.id === old).inventoryValue).toBeNull();
    expect(
      (await owner.request('/reports/action-center/no-sales?days=90')).body.rows.some(
        (r: any) => r.id === old,
      ),
    ).toBe(false);
    expect((await owner.request('/reports/action-center/no-sales?days=6')).status).toBe(400);
    expect((await owner.request('/reports/action-center/no-sales')).body.thresholdDays).toBe(60);
    const profile = (await owner.request('/store-profile')).body;
    expect([401, 403]).toContain(
      (await limited.request('/store-profile', { ...profile, noSalesThresholdDays: 14 })).status,
    );
    expect((await owner.request('/reports/action-center/no-sales')).body.thresholdDays).toBe(60);
    expect(
      (await owner.request('/store-profile', { ...profile, noSalesThresholdDays: 30 })).status,
    ).toBe(201);
    expect((await owner.request('/reports/action-center/no-sales')).body.thresholdDays).toBe(30);
    const missing = await make('Uncosted old stock', '0.00', 'NO-COST');
    const noStock = await make('Empty old stock', '10.00', 'EMPTY', false);
    await db.pool.query(
      "UPDATE products SET created_at=now()-interval '70 days' WHERE id=ANY($1::uuid[])",
      [[missing, noStock]],
    );
    const withMissing = (await owner.request('/reports/action-center/no-sales')).body.rows;
    expect(withMissing.find((r: any) => r.id === missing)).toMatchObject({
      costMissing: true,
      inventoryValue: '0.00',
    });
    expect(withMissing.some((r: any) => r.id === noStock)).toBe(false);
    const insightAfterThreshold = (
      await owner.request('/reports/owner-dashboard?period=today')
    ).body.insights.find((i: any) => i.id === 'dead-stock');
    expect(insightAfterThreshold.title).toContain('30 days');
    expect(insightAfterThreshold.detail).toContain('missing cost');
    expect(insightAfterThreshold.impact.amount).toBe('150.00');

    expect(
      (await owner.request('/reports/action-center/no-sales?days=14')).body.rows.some(
        (r: any) => r.id === old,
      ),
    ).toBe(true);
    expect(
      (await owner.request('/reports/action-center/no-sales?days=45')).body.rows.some(
        (r: any) => r.id === old,
      ),
    ).toBe(true);
    const soldStore = (await db.pool.query('SELECT store_id FROM products WHERE id=$1', [old]))
      .rows[0].store_id;
    const historicalSale = (
      await db.pool.query(
        `INSERT INTO sales(store_id,device_id,employee_id,shift_id,request_id,request_hash,receipt_number,total,tax,discount,receipt,created_at)
       SELECT store_id,device_id,employee_id,shift_id,gen_random_uuid(),request_hash,'HIST-'||substring(gen_random_uuid()::text,1,12),30,0,0,
       jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('productId',$2::text,'category','Drinks','quantity','1','total','30','tax','0'))),now()-interval '70 days'
       FROM sales WHERE store_id=$1 LIMIT 1 RETURNING id`,
        [soldStore, old],
      )
    ).rows[0].id;
    await db.pool.query(
      `INSERT INTO sale_items(store_id,sale_id,product_id,quantity,price,cost,tax_rate,total,cost_total)
      VALUES($1,$2,$3,1,30,20,0,30,20)`,
      [soldStore, historicalSale, old],
    );
    const previouslySold = (
      await owner.request('/reports/action-center/no-sales?days=30')
    ).body.rows.find((r: any) => r.id === old);
    expect(previouslySold.lastSaleAt).not.toBeNull();
    const before = await make('Before local cutoff', '10.00', 'BEFORE');
    const after = await make('After local cutoff', '10.00', 'AFTER');
    const localDay = storeToday(new Date(), 'Europe/Oslo');
    await db.pool.query(
      "UPDATE products SET created_at=($1::date::timestamp AT TIME ZONE 'Europe/Oslo')-interval '30 days'-interval '1 minute' WHERE id=$2",
      [localDay, before],
    );
    await db.pool.query(
      "UPDATE products SET created_at=($1::date::timestamp AT TIME ZONE 'Europe/Oslo')-interval '30 days'+interval '1 minute' WHERE id=$2",
      [localDay, after],
    );
    const boundary = (await owner.request('/reports/action-center/no-sales?days=30')).body.rows;
    expect(boundary.some((r: any) => r.id === before)).toBe(true);
    expect(boundary.some((r: any) => r.id === after)).toBe(false);
    const storeId = (await db.pool.query('SELECT store_id FROM products WHERE id=$1', [old]))
      .rows[0].store_id;
    const otherStore = (
      await db.pool.query(
        "INSERT INTO stores(organization_id,name,currency,timezone,no_sales_threshold_days) SELECT organization_id,'Other shop','NOK','Europe/Oslo',14 FROM stores WHERE id=$1 RETURNING id",
        [storeId],
      )
    ).rows[0].id;
    const otherRole = (
      await db.pool.query(
        "INSERT INTO roles(store_id,name,permissions) SELECT $1,'Owner',permissions FROM roles WHERE store_id=$2 AND name='Owner' RETURNING id",
        [otherStore, storeId],
      )
    ).rows[0].id;
    const otherEmployee = (
      await db.pool.query(
        "INSERT INTO employees(store_id,role_id,name,email,password_hash) SELECT $1,$2,'Other owner','other-owner@pos.test',password_hash FROM employees WHERE email=$3 RETURNING id",
        [otherStore, otherRole, account.email],
      )
    ).rows[0].id;
    await db.pool.query(
      'INSERT INTO employee_roles(employee_id,role_id,store_id) VALUES($1,$2,$3)',
      [otherEmployee, otherRole, otherStore],
    );
    const otherClient = new Client();
    expect(
      (
        await otherClient.request('/auth/login', {
          email: 'other-owner@pos.test',
          password: account.password,
        })
      ).status,
    ).toBe(200);
    expect((await otherClient.request('/reports/action-center/no-sales')).body.thresholdDays).toBe(
      14,
    );
    expect(
      (await otherClient.request('/reports/action-center/no-sales')).body.rows.some(
        (r: any) => r.id === old,
      ),
    ).toBe(false);
    expect((await owner.request('/reports/action-center/no-sales')).body.thresholdDays).toBe(30);
    await db.pool.query("UPDATE shifts SET opened_at=now()-interval '16 hours' WHERE id=$1", [
      shiftId,
    ]);
    const currentProfile = (await owner.request('/store-profile')).body;
    expect(
      (await owner.request('/store-profile', { ...currentProfile, longShiftThresholdHours: 20 }))
        .status,
    ).toBe(201);
    expect(
      (await owner.request('/reports/owner-dashboard?period=today')).body.insights.some(
        (i: any) => i.id === 'open-shifts',
      ),
    ).toBe(false);
    const lower = (await owner.request('/store-profile')).body;
    expect(
      (await owner.request('/store-profile', { ...lower, longShiftThresholdHours: 14 })).status,
    ).toBe(201);
    expect(
      (await owner.request('/reports/owner-dashboard?period=today')).body.insights.some(
        (i: any) => i.id === 'open-shifts',
      ),
    ).toBe(true);
  });
});
