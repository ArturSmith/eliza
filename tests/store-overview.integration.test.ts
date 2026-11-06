import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
import { addDays, storeToday } from '../packages/contracts/src/index';

const admin = new Database();
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_overview_test_${Date.now()}`;
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

describe.sequential('compact store overview', () => {
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

  it('reuses canonical financial values, includes daily shifts and does not invent comparison data', async () => {
    const report = await owner.request('/reports/store-overview');
    expect(report.status).toBe(200);
    const today = storeToday(new Date(), 'Europe/Oslo');
    expect(report.body.day).toBe(today);
    expect(report.body.totalSales).toBe('200.00');
    expect(report.body.comparisonDate).toBeNull();
    expect(report.body.hourly.every((h: any) => h.comparison === null)).toBe(true);
    expect(report.body.shifts).toMatchObject({ total: 1, open: 1, closed: 0 });
    expect(report.body.shifts.rows[0].sales).toBe('200.00');
    const canonical = (await owner.request(`/reports/financial-summary?from=${today}&to=${today}`))
      .body;
    for (const field of [
      'revenue',
      'cogs',
      'grossProfit',
      'grossMarginPercent',
      'operatingExpenses',
      'storeOperatingProfit',
    ])
      expect(report.body.financialSummary[field]).toEqual(canonical[field]);
  });
  it('keeps long shifts scoped to the selected day and compares actual matching weekdays', async () => {
    const today = storeToday(new Date(), 'Europe/Oslo'),
      prior = addDays(today, -7);
    await db.pool.query(
      "UPDATE shifts SET opened_at=($1::date+time '08:00') AT TIME ZONE 'Europe/Oslo' WHERE id=$2",
      [prior, shiftId],
    );
    await db.pool.query(
      `INSERT INTO sales(store_id,device_id,employee_id,shift_id,request_id,request_hash,receipt_number,total,tax,discount,receipt,created_at)
      SELECT store_id,device_id,employee_id,id,$2,'overview-fixture','OVERVIEW-PRIOR',160,0,0,'{"lines":[]}',($3::date+time '10:00') AT TIME ZONE 'Europe/Oslo' FROM shifts WHERE id=$1`,
      [shiftId, crypto.randomUUID(), prior],
    );
    const current = (await owner.request('/reports/store-overview')).body;
    expect(current.totalSales).toBe('200.00');
    expect(current.shifts.rows[0].sales).toBe('200.00');
    expect(current.comparisonDate).toBe(prior);
    expect(current.hourly[10].comparison).toBe(160);
    const old = (await owner.request('/reports/store-overview?date=' + prior)).body;
    expect(old.totalSales).toBe('160.00');
    expect(old.shifts.rows[0].sales).toBe('160.00');
    expect(old.financialSummary.grossProfit).toBeNull();
    expect(old.hourly.every((h: any) => h.elapsed)).toBe(true);
    const empty = (await owner.request('/reports/store-overview?date=2000-01-01')).body;
    expect(empty.totalSales).toBe('0.00');
    expect(empty.shifts.total).toBe(0);
  });
  it('validates dates and requires analytics access', async () => {
    expect((await owner.request('/reports/store-overview?date=2026-02-30')).status).toBe(400);
    expect(
      (
        await owner.request(
          '/reports/store-overview?date=' + addDays(storeToday(new Date(), 'Europe/Oslo'), 1),
        )
      ).status,
    ).toBe(400);
    expect((await register.request('/reports/store-overview')).status).toBe(401);
    const roles = (await owner.request('/team/roles')).body;
    await owner.request('/team', {
      name: 'Read-only cashier',
      employeeCode: 'CASH-READ',
      roleId: roles.find((r: any) => r.name === 'Cashier').id,
      pin: '888999',
      email: 'overview-cashier@pos.test',
      password: 'cashier-password-12345',
    });
    const cashier = new Client();
    await cashier.request('/auth/login', {
      email: 'overview-cashier@pos.test',
      password: 'cashier-password-12345',
    });
    expect((await cashier.request('/reports/store-overview')).status).toBe(403);
  });
  it('masks private financial values without hiding accessible sales', async () => {
    const roles = (await owner.request('/team/roles')).body;
    const role = roles.find((r: any) => r.name === 'Manager');
    await db.pool.query(
      `UPDATE roles SET permissions=(SELECT coalesce(jsonb_agg(p),'[]'::jsonb) FROM jsonb_array_elements(permissions) p WHERE p NOT IN ('"analytics.margin"'::jsonb,'"expenses.read"'::jsonb)) WHERE id=$1`,
      [role.id],
    );
    await owner.request('/team', {
      name: 'Limited',
      employeeCode: 'LIMITED',
      roleId: role.id,
      pin: '555666',
      email: 'limited-overview@pos.test',
      password: 'limited-password-12345',
    });
    const limited = new Client();
    await limited.request('/auth/login', {
      email: 'limited-overview@pos.test',
      password: 'limited-password-12345',
    });
    const report = await limited.request('/reports/store-overview');
    expect(report.status).toBe(200);
    expect(report.body.totalSales).toBe('200.00');
    expect(report.body.financialSummary).toMatchObject({
      grossProfit: null,
      grossMarginPercent: null,
      operatingExpenses: null,
      storeOperatingProfit: null,
      estimated: null,
      permissions: { margin: false, expenses: false },
    });
  });
});
