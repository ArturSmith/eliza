import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
const admin = new Database();
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_pos_test_${Date.now()}`;
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
describe.sequential('register, shifts and checkout', () => {
  it('creates PIN-only staff and sets an owner approval PIN without leaking credentials', async () => {
    expect((await manager.request('/auth/setup', account)).status).toBe(201);
    const session = (await manager.request('/auth/session')).body;
    ownerId = session.user.id;
    const roles = (await manager.request('/team/roles')).body;
    cashierRole = roles.find((r: any) => r.name === 'Cashier').id;
    ownerRole = roles.find((r: any) => r.name === 'Owner').id;
    expect(
      (
        await manager.request(
          `/team/${ownerId}`,
          { name: 'Owner', employeeCode: 'OWNER', roleId: ownerRole, active: true, pin: '654321' },
          'PATCH',
        )
      ).status,
    ).toBe(200);
    const created = await manager.request('/team', {
      name: 'Anna',
      employeeCode: 'ANNA',
      roleId: cashierRole,
      pin: '123456',
    });
    expect(created.status).toBe(201);
    cashierId = created.body.id;
    const staff = (await manager.request('/employees')).body;
    expect(staff.find((e: any) => e.id === cashierId).hasPin).toBe(true);
    expect(JSON.stringify(staff)).not.toMatch(/123456|pinHash|pin_hash|passwordHash/);
  });
  it('requires enrollment and ends management access in a cashier browser', async () => {
    expect((await unlock()).status).toBe(401);
    deviceId = await enroll(register, 'Register 01');
    expect((await register.request('/auth/session')).status).toBe(401);
    expect((await unlock()).status).toBe(200);
    expect((await register.request('/employees')).status).toBe(401);
    expect((await register.request('/pos/context')).body.operator.name).toBe('Anna');
  });
  it('requires a shift and keeps purchase costs out of the POS catalog', async () => {
    productId = (await manager.request('/products', product)).body.id;
    await manager.request('/inventory/adjustments', {
      productId,
      quantity: '20',
      reason: 'opening_balance',
      requestId: crypto.randomUUID(),
    });
    weightedId = (
      await manager.request('/products', {
        ...product,
        name: 'Apples',
        sku: 'APPLE',
        unit: 'kilogram',
        price: '29.90',
        plu: '4011',
        barcodes: [],
      })
    ).body.id;
    await manager.request('/inventory/adjustments', {
      productId: weightedId,
      quantity: '10',
      reason: 'opening_balance',
      requestId: crypto.randomUUID(),
    });
    const catalog = (await register.request('/pos/products')).body;
    expect(catalog[0]).not.toHaveProperty('cost');
    expect(
      (await register.request('/pos/sales', sale({ shiftId: crypto.randomUUID() }))).status,
    ).toBe(409);
  });
  it('opens one shift and safely handles duplicate opening requests', async () => {
    const body = { requestId: crypto.randomUUID(), openingCash: '100' };
    const results = await Promise.all([
      register.request('/pos/shifts', body),
      register.request('/pos/shifts', body),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0].body.id).toBe(results[1].body.id);
    shiftId = results[0].body.id;
    expect(results[0].body.expectedCash).toBe('100.00');
    expect(
      (
        await register.request('/pos/shifts', {
          requestId: crypto.randomUUID(),
          openingCash: '200',
        })
      ).status,
    ).toBe(409);
  });
  it('completes a sale exactly once and links all stock, payment, and cash records', async () => {
    const payload = sale();
    const results = await Promise.all([
      register.request('/pos/sales', payload),
      register.request('/pos/sales', payload),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const receipt = results[0].body;
    receiptId = receipt.id;
    expect(results[1].body.id).toBe(receiptId);
    expect(receipt.total).toBe('115.00');
    expect(receipt.tax).toBe('15.00');
    expect(receipt.payment.change).toBe('5.00');
    expect(receipt.cashierName).toBe('Anna');
    const stock = (await db.pool.query('SELECT stock FROM products WHERE id=$1', [productId]))
      .rows[0].stock;
    expect(stock).toBe('19.000');
    expect(
      (await db.pool.query('SELECT id FROM payments WHERE sale_id=$1', [receiptId])).rowCount,
    ).toBe(1);
    expect(
      (await db.pool.query('SELECT shift_id FROM movements WHERE sale_id=$1', [receiptId])).rows[0]
        .shift_id,
    ).toBe(shiftId);
    expect((await register.request('/pos/context')).body.shift.expectedCash).toBe('215.00');
    expect(
      (
        await register.request('/pos/sales', {
          ...payload,
          payment: { method: 'cash', tendered: '130' },
        })
      ).status,
    ).toBe(409);
  });
  it('rejects stock conflicts, changed prices, bad quantities, and insufficient payment atomically', async () => {
    for (const overrides of [
      { lines: [{ productId, quantity: '999', expectedPrice: '115.00', expectedTaxRate: '15' }] },
      { lines: [{ productId, quantity: '0.5', expectedPrice: '115.00', expectedTaxRate: '15' }] },
      { lines: [{ productId, quantity: '1', expectedPrice: '1.00', expectedTaxRate: '15' }] },
      { payment: { method: 'cash', tendered: '1' } },
    ]) {
      const r = await register.request('/pos/sales', sale(overrides));
      expect([400, 409]).toContain(r.status);
    }
    expect((await db.pool.query('SELECT count(*)::int n FROM sales')).rows[0].n).toBe(1);
    expect(
      (await db.pool.query('SELECT stock FROM products WHERE id=$1', [productId])).rows[0].stock,
    ).toBe('19.000');
  });
  it('requires and records manager approval without switching the active cashier', async () => {
    const payload = sale({ discountPercent: '20', payment: { method: 'cash', tendered: '100' } });
    expect((await register.request('/pos/sales', payload)).status).toBe(403);
    expect(
      (
        await register.request('/pos/sales', {
          ...payload,
          approval: { employeeCode: 'OWNER', pin: '000000' },
        })
      ).status,
    ).toBe(401);
    const r = await register.request('/pos/sales', {
      ...payload,
      approval: { employeeCode: 'OWNER', pin: '654321' },
    });
    expect(r.status).toBe(201);
    expect(r.body.total).toBe('92.00');
    expect(r.body.approverName).toBe('Owner');
    expect(r.body.cashierName).toBe('Anna');
    expect((await register.request('/pos/context')).body.operator.name).toBe('Anna');
    expect((await register.request('/pos/sales', payload)).body.id).toBe(r.body.id);
  });
  it('handles fractional weighted sales and records card payments without changing the cash drawer', async () => {
    const before = (await register.request('/pos/context')).body.shift.expectedCash;
    const payload = sale({
      lines: [
        { productId: weightedId, quantity: '1.350', expectedPrice: '29.90', expectedTaxRate: '15' },
      ],
      discountPercent: '10',
      payment: { method: 'card', tendered: '36.33' },
    });
    const r = await register.request('/pos/sales', payload);
    expect(r.status).toBe(201);
    expect(r.body.total).toBe('36.33');
    expect(r.body.tax).toBe('4.74');
    expect((await register.request('/pos/context')).body.shift.expectedCash).toBe(before);
    expect(
      (await db.pool.query('SELECT stock FROM products WHERE id=$1', [weightedId])).rows[0].stock,
    ).toBe('8.650');
  });
  it('prevents a second register from opening a shift for the same employee', async () => {
    await enroll(second, 'Register 02');
    expect((await unlock(second)).status).toBe(200);
    expect(
      (await second.request('/pos/shifts', { requestId: crypto.randomUUID(), openingCash: '0' }))
        .status,
    ).toBe(409);
  });
  it('locks the current session and stops employee switching during an open shift', async () => {
    const oldToken = register.cookies.get('eliza_pos_session');
    expect((await register.request('/pos/lock', {})).status).toBe(200);
    register.cookies.set('eliza_pos_session', oldToken!);
    expect((await register.request('/pos/products')).status).toBe(401);
    expect((await unlock(register, 'OWNER', '654321')).status).toBe(409);
    expect((await unlock()).status).toBe(200);
  });
  it('requires approval for a cash discrepancy and makes closed shifts immutable', async () => {
    const payload = { requestId: crypto.randomUUID(), countedCash: '300', notes: 'Counted short' };
    expect((await register.request(`/pos/shifts/${shiftId}/close`, payload)).status).toBe(403);
    const closed = await register.request(`/pos/shifts/${shiftId}/close`, {
      ...payload,
      approval: { employeeCode: 'OWNER', pin: '654321' },
    });
    expect(closed.status).toBe(201);
    expect(closed.body.expectedCash).toBe('307.00');
    expect(closed.body.difference).toBe('-7.00');
    expect((await register.request(`/pos/shifts/${shiftId}/close`, payload)).body.id).toBe(shiftId);
    await expect(
      db.pool.query('UPDATE shifts SET counted_cash=1 WHERE id=$1', [shiftId]),
    ).rejects.toThrow('immutable');
    expect((await register.request('/pos/sales', sale())).status).toBe(409);
  });
  it('records cash in/out idempotently and blocks withdrawals above drawer balance', async () => {
    expect((await unlock(register, 'OWNER', '654321')).status).toBe(200);
    await register.request('/pos/shifts', { requestId: crypto.randomUUID(), openingCash: '50' });
    const payload = {
      requestId: crypto.randomUUID(),
      direction: 'out',
      amount: '10',
      reason: 'Safe drop',
    };
    const first = await register.request('/pos/cash', payload);
    expect(first.status).toBe(201);
    expect((await register.request('/pos/cash', payload)).body.id).toBe(first.body.id);
    expect(
      (
        await register.request('/pos/cash', {
          ...payload,
          requestId: crypto.randomUUID(),
          amount: '99',
        })
      ).status,
    ).toBe(400);
    expect((await register.request('/pos/context')).body.shift.expectedCash).toBe('40.00');
  });
  it('prevents two registers from overselling the same last unit', async () => {
    await manager.request('/team', {
      name: 'Ben',
      employeeCode: 'BEN',
      roleId: cashierRole,
      pin: '111222',
    });
    expect((await unlock(second, 'BEN', '111222')).status).toBe(200);
    const otherShift = (
      await second.request('/pos/shifts', { requestId: crypto.randomUUID(), openingCash: '0' })
    ).body.id;
    const ownShift = (await register.request('/pos/context')).body.shift.id;
    const last = (
      await manager.request('/products', {
        ...product,
        name: 'Last item',
        sku: 'LAST',
        price: '10',
        taxRate: '0',
        plu: '',
        barcodes: [],
      })
    ).body.id;
    await manager.request('/inventory/adjustments', {
      productId: last,
      quantity: '1',
      reason: 'opening_balance',
      requestId: crypto.randomUUID(),
    });
    const line = { productId: last, quantity: '1', expectedPrice: '10', expectedTaxRate: '0' };
    const results = await Promise.all([
      register.request(
        '/pos/sales',
        sale({ shiftId: ownShift, lines: [line], payment: { method: 'cash', tendered: '10' } }),
      ),
      second.request(
        '/pos/sales',
        sale({ shiftId: otherShift, lines: [line], payment: { method: 'cash', tendered: '10' } }),
      ),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (await db.pool.query('SELECT stock FROM products WHERE id=$1', [last])).rows[0].stock,
    ).toBe('0.000');
  });
  it('reports historic prices and does not expose staff credentials in audit', async () => {
    await manager.request(`/products/${productId}`, { ...product, price: '999' }, 'PATCH');
    const receipts = (await manager.request('/reports/sales')).body;
    expect(receipts.find((r: any) => r.id === receiptId).total).toBe('115.00');
    const log = (await manager.request('/audit')).body;
    expect(JSON.stringify(log)).not.toMatch(/654321|123456|pin_hash|password_hash/);
    await expect(db.pool.query('DELETE FROM sales WHERE id=$1', [receiptId])).rejects.toThrow(
      'append-only',
    );
  });
  it('retains failed PIN attempts across requests and blocks the sixth attempt', async () => {
    await second.request('/pos/lock', {});
    for (let i = 0; i < 5; i++) expect((await unlock(second, 'ANNA', '000000')).status).toBe(401);
    expect((await unlock(second)).status).toBe(429);
    const attempt = (
      await db.pool.query(
        'SELECT failures FROM pin_attempts p JOIN devices d ON d.id=p.device_id WHERE d.name=$1',
        ['Register 02'],
      )
    ).rows[0];
    expect(attempt.failures).toBe(5);
  });
  it('blocks disabled devices and cannot use PIN credentials to gain management access', async () => {
    expect(
      (
        await manager.request(
          `/devices/${deviceId}`,
          { name: 'Register 01', active: false },
          'PATCH',
        )
      ).status,
    ).toBe(200);
    expect((await register.request('/pos/sales', sale())).status).toBe(403);
    expect((await register.request('/pos/context')).body.blocked).toBe(true);
    expect((await register.request('/auth/session')).status).toBe(401);
  });

  it('reports exact totals and shift/month groups without drawer float or receipt limits', async () => {
    const bounds = (
      await db.pool.query(
        "SELECT to_char(min(created_at) AT TIME ZONE 'Europe/Oslo','YYYY-MM-DD') AS first,to_char(max(created_at) AT TIME ZONE 'Europe/Oslo','YYYY-MM-DD') AS last FROM sales",
      )
    ).rows[0];
    const expected = (
      await db.pool.query(
        'SELECT sum(total)::text AS total,sum(tax)::text AS tax,sum(discount)::text AS discount,count(*)::text AS transactions FROM sales',
      )
    ).rows[0];
    for (const group of [
      'day',
      'week',
      'month',
      'shift',
      'cashier',
      'register',
      'product',
      'category',
      'payment',
    ]) {
      const r = await manager.request(
        `/reports/sales-summary?from=${bounds.first}&to=${bounds.last}&group=${group}`,
      );
      expect(r.status).toBe(200);
      expect(r.body.totals).toMatchObject(expected);
      const payment = (
        await db.pool.query(
          "SELECT COALESCE(sum(amount) FILTER(WHERE method='cash'),0)::text AS cash,COALESCE(sum(amount) FILTER(WHERE method='card'),0)::text AS card FROM payments",
        )
      ).rows[0];
      expect(r.body.totals).toMatchObject(payment);
      expect(r.body.rows.length).toBeGreaterThan(0);
      const cents = (v: string) => BigInt(v.replace('.', ''));
      expect(r.body.rows.reduce((sum: bigint, row: any) => sum + cents(row.total), 0n)).toBe(
        cents(expected.total),
      );
      if (group === 'product')
        expect(r.body.rows.every((row: any) => row.quantity && row.unit && row.cash === null)).toBe(
          true,
        );
      if (group === 'category')
        expect(r.body.rows.some((row: any) => row.label === 'Dairy')).toBe(true);
      if (group === 'shift')
        expect(r.body.rows.every((row: any) => row.cashier && row.register && row.openedAt)).toBe(
          true,
        );
    }
  });
  it('validates reporting dates, returns empty totals, and requires management access', async () => {
    for (const query of [
      'from=2026-02-30&to=2026-03-01',
      'from=2026-02-02&to=2026-02-01',
      'from=2000-01-01&to=2026-01-01',
      'from=2026-01-01&to=2026-01-31&group=invalid',
    ])
      expect((await manager.request('/reports/sales-summary?' + query)).status).toBe(400);
    const empty = await manager.request('/reports/sales-summary?from=2000-01-01&to=2000-01-31');
    expect(empty.status).toBe(200);
    expect(empty.body.rows).toEqual([]);
    expect(empty.body.totals.transactions).toBe('0');
    expect(Number(empty.body.totals.total)).toBe(0);
    expect(
      (await register.request('/reports/sales-summary?from=2000-01-01&to=2000-01-31')).status,
    ).toBe(401);
  });

  it('includes all sales beyond 100 receipts and honors DST midnight boundaries', async () => {
    const seed = (await db.pool.query('SELECT * FROM sales LIMIT 1')).rows[0];
    for (const [count, timestamp] of [
      [103, '2020-03-28T23:00:00Z'],
      [1, '2020-03-29T21:59:59Z'],
      [1, '2020-03-28T22:59:59Z'],
      [1, '2020-03-29T22:00:00Z'],
    ] as const) {
      await db.pool.query(
        `INSERT INTO sales(store_id,device_id,employee_id,shift_id,request_id,request_hash,receipt_number,total,tax,discount,receipt,created_at)
        SELECT $1,$2,$3,$4,gen_random_uuid(),'report-fixture',gen_random_uuid()::text,1,0,0,$5,$6::timestamptz FROM generate_series(1,$7::int)`,
        [
          seed.store_id,
          seed.device_id,
          seed.employee_id,
          seed.shift_id,
          seed.receipt,
          timestamp,
          count,
        ],
      );
    }
    const r = await manager.request(
      '/reports/sales-summary?from=2020-03-29&to=2020-03-29&group=day',
    );
    expect(r.status).toBe(200);
    expect(r.body.totals.transactions).toBe('104');
    expect(r.body.totals.total).toBe('104.00');
    expect(r.body.rows).toHaveLength(1);
    expect(r.body.rows[0].bucket).toBe('2020-03-29');
    const weekly = await manager.request(
      '/reports/sales-summary?from=2020-03-29&to=2020-03-29&group=week',
    );
    expect(weekly.body.rows[0].bucket).toBe('2020-03-23');
    expect(weekly.body.totals.total).toBe('104.00');
  });

  it('groups original product/category values and counts a multi-line receipt only once', async () => {
    const seed = (await db.pool.query('SELECT * FROM sales LIMIT 1')).rows[0];
    const product = crypto.randomUUID();
    const receipt = {
      ...seed.receipt,
      lines: [
        {
          productId: product,
          name: 'Original name',
          sku: 'A',
          unit: 'piece',
          quantity: '2',
          total: '20.00',
          tax: '2.00',
          discount: '1.00',
          category: 'Original category',
        },
        {
          productId: product,
          name: 'Original name',
          sku: 'A',
          unit: 'piece',
          quantity: '1',
          total: '10.00',
          tax: '1.00',
          discount: '0.00',
          category: 'Original category',
        },
        {
          productId: crypto.randomUUID(),
          name: 'Old item',
          sku: 'B',
          unit: 'kilogram',
          quantity: '0.5',
          total: '5.00',
          tax: '0.00',
          discount: '0.00',
        },
      ],
    };
    await db.pool.query(
      `INSERT INTO sales(store_id,device_id,employee_id,shift_id,request_id,request_hash,receipt_number,total,tax,discount,receipt,created_at)
    VALUES($1,$2,$3,$4,gen_random_uuid(),'fixture',gen_random_uuid()::text,35,3,1,$5,'2021-01-01T12:00:00Z')`,
      [seed.store_id, seed.device_id, seed.employee_id, seed.shift_id, receipt],
    );
    const p = (
      await manager.request('/reports/sales-summary?from=2021-01-01&to=2021-01-01&group=product')
    ).body;
    expect(p.totals.transactions).toBe('1');
    expect(p.totals.average).toBe('35.00');
    expect(p.rows.find((r: any) => r.bucket === product)).toMatchObject({
      transactions: '1',
      quantity: '3',
      total: '30.00',
      average: '30.00',
      label: 'Original name · A',
    });
    const c = (
      await manager.request('/reports/sales-summary?from=2021-01-01&to=2021-01-01&group=category')
    ).body;
    expect(c.rows.find((r: any) => r.bucket === 'Original category')).toMatchObject({
      transactions: '1',
      total: '30.00',
    });
    expect(c.rows.find((r: any) => r.bucket === 'Unrecorded category').total).toBe('5.00');
  });
});
