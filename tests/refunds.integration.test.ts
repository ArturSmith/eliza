import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
const admin = new Database();
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_refund_test_${Date.now()}`;
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

let refundBody: any;
describe.sequential('receipt search and refunds', () => {
  it('sets up an approved cashier sale', async () => {
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
    productId = (await manager.request('/products', { ...product, price: '0.05', taxRate: '0' }))
      .body.id;
    await manager.request('/inventory/adjustments', {
      requestId: crypto.randomUUID(),
      productId,
      quantity: '3',
      reason: 'opening_balance',
    });
    const response = await register.request(
      '/pos/sales',
      sale({
        lines: [{ productId, quantity: '3', expectedPrice: '0.05', expectedTaxRate: '0' }],
        discountPercent: '10',
        payment: { method: 'cash', tendered: '1' },
      }),
    );
    expect(response.status).toBe(201);
    receiptId = response.body.id;
    expect(response.body.total).toBe('0.13');
    refundBody = {
      requestId: crypto.randomUUID(),
      saleId: receiptId,
      reason: 'Customer return',
      method: 'cash',
      confirmed: true,
      lines: [{ productId, quantity: '1', restock: true }],
    };
  });
  it('searches receipts and requires approval with persisted wrong-PIN attempts', async () => {
    const found = await manager.request('/reports/receipt-search?q=' + receiptId);
    expect(found.body.receipts[0].id).toBe(receiptId);
    expect(
      (await register.request('/pos/receipt-search?q=' + receiptId)).body.receipts,
    ).toHaveLength(1);
    expect((await manager.request('/reports/receipt-search?from=2026-02-30')).status).toBe(400);
    expect((await register.request('/pos/refunds', refundBody)).status).toBe(403);
    expect(
      (
        await register.request('/pos/refunds', {
          ...refundBody,
          approval: { employeeCode: 'OWNER', pin: '000000' },
        })
      ).status,
    ).toBe(401);
    expect((await db.pool.query('SELECT failures FROM pin_attempts')).rows[0].failures).toBe(1);
  });
  it('commits one refund for concurrent retries and restores stock and cash correctly', async () => {
    refundBody.approval = { employeeCode: 'OWNER', pin: '654321' };
    const results = await Promise.all([
      register.request('/pos/refunds', refundBody),
      register.request('/pos/refunds', refundBody),
    ]);
    expect(results[0].status).toBe(201);
    expect(results[1].body).toEqual(results[0].body);
    expect(results[0].body.total).toBe('0.04');
    expect(
      (await db.pool.query('SELECT stock FROM products WHERE id=$1', [productId])).rows[0].stock,
    ).toBe('1.000');
    expect(
      (
        await db.pool.query(
          'SELECT sum(amount)::text AS total FROM cash_movements WHERE shift_id=$1',
          [shiftId],
        )
      ).rows[0].total,
    ).toBe('100.09');
    expect(
      (await register.request('/pos/refunds', { ...refundBody, reason: 'Changed' })).status,
    ).toBe(409);
    await expect(db.pool.query('DELETE FROM refunds')).rejects.toThrow();
  });
  it('rejects over-refunds and preserves original receipt after full partial refunds', async () => {
    expect(
      (
        await register.request('/pos/refunds', {
          ...refundBody,
          requestId: crypto.randomUUID(),
          lines: [{ productId, quantity: '3', restock: true }],
        })
      ).status,
    ).toBe(409);
    for (const restock of [false, true])
      expect(
        (
          await register.request('/pos/refunds', {
            ...refundBody,
            requestId: crypto.randomUUID(),
            lines: [{ productId, quantity: '1', restock }],
          })
        ).status,
      ).toBe(201);
    expect(
      (await db.pool.query('SELECT sum(total)::text AS total FROM refunds')).rows[0].total,
    ).toBe('0.13');
    expect(
      (await db.pool.query('SELECT stock FROM products WHERE id=$1', [productId])).rows[0].stock,
    ).toBe('2.000');
    const d = (await manager.request('/reports/receipt-search/' + receiptId)).body;
    expect(d.refunds).toHaveLength(3);
    expect(d.returned[0].quantity).toBe('3.000');
    expect(d.receipt.total).toBe('0.13');
    expect(
      (await register.request('/pos/refunds', { ...refundBody, requestId: crypto.randomUUID() }))
        .status,
    ).toBe(409);
  });

  it('records external card refunds without changing the cash drawer and reports refunds separately', async () => {
    const saleResult = await register.request(
      '/pos/sales',
      sale({
        lines: [{ productId, quantity: '1', expectedPrice: '0.05', expectedTaxRate: '0' }],
        payment: { method: 'card', tendered: '0.05' },
      }),
    );
    expect(saleResult.status).toBe(201);
    const body = {
      ...refundBody,
      requestId: crypto.randomUUID(),
      saleId: saleResult.body.id,
      method: 'card',
    };
    expect((await register.request('/pos/refunds', { ...body, method: 'cash' })).status).toBe(400);
    const before = (await db.pool.query('SELECT sum(amount)::text AS total FROM cash_movements'))
      .rows[0].total;
    expect((await register.request('/pos/refunds', body)).status).toBe(201);
    expect(
      (await db.pool.query('SELECT sum(amount)::text AS total FROM cash_movements')).rows[0].total,
    ).toBe(before);
    const day = (
      await db.pool.query("SELECT to_char(now() AT TIME ZONE 'Europe/Oslo','YYYY-MM-DD') AS day")
    ).rows[0].day;
    const report = (await manager.request(`/reports/sales-summary?from=${day}&to=${day}`)).body;
    expect(report.totals.refunds).toBe('0.18');
    expect(report.totals.net).toBe('0.00');
  });
});
