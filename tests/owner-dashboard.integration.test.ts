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
  });

  it('marks comparisons unavailable instead of inventing a baseline', async () => {
    const res = await owner.request('/reports/owner-dashboard?period=today');
    expect(res.body.kpis.revenue.change).toBeNull();
    expect(res.body.comparisons.some((c: any) => c.available === false)).toBe(true);
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
    expect(report.unavailable.some((u: any) => u.metric === 'operatingExpenses')).toBe(false);
    const historical = (
      await owner.request('/reports/owner-dashboard?period=custom&from=2000-01-02&to=2000-01-02')
    ).body;
    expect(historical.kpis.totalSpending.value).toBe(905.75);
    expect(historical.kpis.netProfit.value).toBe(-5.75);
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
    await db.pool.query(
      `UPDATE roles SET permissions=(SELECT COALESCE(jsonb_agg(p),'[]'::jsonb) FROM jsonb_array_elements(permissions) p WHERE p NOT IN ('"expenses.read"'::jsonb,'"purchases.read"'::jsonb)) WHERE id=$1`,
      [manager.id],
    );
    const restricted = (await limited.request('/reports/owner-dashboard?period=today')).body;
    expect(restricted.kpis.operatingExpenses.value).toBeNull();
    expect(restricted.kpis.paidPurchases.value).toBeNull();
    expect(restricted.kpis.totalSpending.value).toBeNull();
    expect(restricted.kpis.totalSpending.restricted).toBe(true);
  });
});
