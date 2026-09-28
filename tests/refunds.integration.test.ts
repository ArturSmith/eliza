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
let ownerQr: string;
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
    ownerQr = (await manager.request('/team/' + session.user.id + '/qr', {})).body.qrCredential;
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
    refundBody.approval = { qrCredential: ownerQr };
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
          'SELECT sum(quantity)::text AS quantity FROM stock_batches WHERE product_id=$1',
          [productId],
        )
      ).rows[0].quantity,
    ).toBe('1.000');
    expect(
      (await db.pool.query('SELECT sum(quantity)::text AS quantity FROM refund_batch_allocations'))
        .rows[0].quantity,
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

  it('uses historical costs and retains losses on non-saleable returns', async () => {
    const day = (
      await db.pool.query("SELECT to_char(now() AT TIME ZONE 'Europe/Oslo','YYYY-MM-DD') AS day")
    ).rows[0].day;
    const path = `/reports/gross-profit?from=${day}&to=${day}`;
    const before = await manager.request(path);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({
      salesExTax: '0.18',
      refundsExTax: '0.18',
      netRevenue: '0.00',
      soldCost: '200.00',
      restoredCost: '150.00',
      costOfGoodsSold: '50.00',
      grossProfit: '-50.00',
      marginPercent: null,
      missingCostRecords: '0',
    });
    await db.pool.query('UPDATE products SET cost=999 WHERE id=$1', [productId]);
    expect((await manager.request(path)).body).toEqual(before.body);
    expect((await register.request(path)).status).toBe(401);
    const role = (await manager.request('/team/roles')).body.find((r: any) => r.name === 'Cashier');
    await manager.request('/team', {
      name: 'Limited',
      employeeCode: 'LIMITED',
      roleId: role.id,
      pin: '234567',
      email: 'limited@profit.test',
      password: 'limited-password-123',
    });
    const limited = new Client();
    await limited.request('/auth/login', {
      email: 'limited@profit.test',
      password: 'limited-password-123',
    });
    expect((await limited.request(path)).status).toBe(403);
    expect(
      (await manager.request('/reports/gross-profit?from=2026-02-30&to=2026-03-01')).status,
    ).toBe(400);
    const empty = (await manager.request('/reports/gross-profit?from=2000-01-01&to=2000-01-01'))
      .body;
    expect(Number(empty.grossProfit)).toBe(0);
    expect(empty.marginPercent).toBeNull();
  });
  it('allocates rounded historical cost across partial restocks on their refund dates', async () => {
    const seed = (await db.pool.query('SELECT * FROM sales LIMIT 1')).rows[0];
    const sold = (
      await db.pool.query(
        `INSERT INTO sales(store_id,device_id,employee_id,shift_id,request_id,request_hash,receipt_number,total,tax,discount,receipt,created_at) VALUES($1,$2,$3,$4,gen_random_uuid(),'profit-fixture',gen_random_uuid()::text,0.03,0,0,$5,'2020-01-01T12:00:00Z') RETURNING id`,
        [seed.store_id, seed.device_id, seed.employee_id, seed.shift_id, seed.receipt],
      )
    ).rows[0].id;
    await db.pool.query(
      'INSERT INTO sale_items(store_id,sale_id,product_id,quantity,price,cost,tax_rate,total) VALUES($1,$2,$3,1.5,0.02,0.01,0,0.03)',
      [seed.store_id, sold, productId],
    );
    for (const day of [2, 3, 4]) {
      const r = (
        await db.pool.query(
          `INSERT INTO refunds(store_id,sale_id,shift_id,employee_id,device_id,approver_id,request_id,request_hash,number,method,reason,total,tax,receipt,created_at) VALUES($1,$2,$3,$4,$5,$4,gen_random_uuid(),'fixture',gen_random_uuid()::text,'cash','Fixture',0.01,0,'{}',$6) RETURNING id`,
          [
            seed.store_id,
            sold,
            seed.shift_id,
            seed.employee_id,
            seed.device_id,
            `2020-01-0${day}T12:00:00Z`,
          ],
        )
      ).rows[0].id;
      await db.pool.query(
        'INSERT INTO refund_lines(store_id,refund_id,sale_id,product_id,quantity,restock,total,tax) VALUES($1,$2,$3,$4,0.5,true,0.01,0)',
        [seed.store_id, r, sold, productId],
      );
    }
    for (const [day, cost] of [
      [2, '0.01'],
      [3, '0.00'],
      [4, '0.01'],
    ]) {
      const r = (
        await manager.request(`/reports/gross-profit?from=2020-01-0${day}&to=2020-01-0${day}`)
      ).body;
      expect(r.restoredCost).toBe(cost);
      expect(r.netRevenue).toBe('-0.01');
      const dashboard = (
        await manager.request(
          `/reports/owner-dashboard?period=custom&from=2020-01-0${day}&to=2020-01-0${day}`,
        )
      ).body;
      expect(dashboard.kpis.grossProfit.value).toBe(Number(r.grossProfit));
      expect(dashboard.kpis.netProfit.value).toBe(Number(r.grossProfit));
    }
    const total = (await manager.request('/reports/gross-profit?from=2020-01-01&to=2020-01-04'))
      .body;
    expect(total.soldCost).toBe('0.02');
    expect(total.restoredCost).toBe('0.02');
    expect(total.grossProfit).toBe('0.00');
    const dashboard = (
      await manager.request('/reports/owner-dashboard?period=custom&from=2020-01-01&to=2020-01-04')
    ).body;
    expect(dashboard.kpis.grossProfit.value).toBe(0);
  });

  it('withholds profit when historical cost records are missing', async () => {
    const seed = (await db.pool.query('SELECT * FROM sales LIMIT 1')).rows[0];
    await db.pool.query(
      `INSERT INTO sales(store_id,device_id,employee_id,shift_id,request_id,request_hash,receipt_number,total,tax,discount,receipt,created_at) VALUES($1,$2,$3,$4,gen_random_uuid(),'missing-cost',gen_random_uuid()::text,100,20,0,$5,'2002-01-01T12:00:00Z')`,
      [seed.store_id, seed.device_id, seed.employee_id, seed.shift_id, seed.receipt],
    );
    const r = (await manager.request('/reports/gross-profit?from=2002-01-01&to=2002-01-01')).body;
    expect(r.salesExTax).toBe('80.00');
    expect(r.grossProfit).toBeNull();
    expect(r.costOfGoodsSold).toBeNull();
    expect(r.missingCostRecords).toBe('1');
    const dashboard = (
      await manager.request('/reports/owner-dashboard?period=custom&from=2002-01-01&to=2002-01-01')
    ).body;
    expect(dashboard.kpis.grossProfit.value).toBeNull();
    expect(dashboard.kpis.netProfit.value).toBeNull();
  });

  it('updates store settings, defaults new product tax, and preserves original receipt details', async () => {
    const profile = (await manager.request('/store-profile')).body;
    const settings = {
      ...profile,
      name: 'Updated Market',
      address: 'Main street 1',
      phone: '12345',
      businessNumber: 'ORG-1',
      receiptFooter: 'Come again!',
      defaultTaxRate: '25',
    };
    expect((await manager.request('/store-profile', settings)).status).toBe(201);
    expect((await manager.request('/store-profile', settings)).status).toBe(409);
    const current = (await manager.request('/store-profile')).body;
    expect(
      (await manager.request('/store-profile', { ...current, defaultTaxRate: '101' })).status,
    ).toBe(400);
    const { taxRate, ...base } = product;
    const p = await manager.request('/products', {
      ...base,
      name: 'New taxed item',
      sku: 'SETTINGS',
      plu: '',
      barcodes: [],
      price: '11.50',
    });
    expect(p.status).toBe(201);
    expect(p.body.taxRate).toBe('25.00');
    expect(
      (await db.pool.query('SELECT tax_rate FROM products WHERE id=$1', [productId])).rows[0]
        .tax_rate,
    ).toBe('0.00');
    await manager.request('/inventory/adjustments', {
      requestId: crypto.randomUUID(),
      productId: p.body.id,
      quantity: '1',
      reason: 'opening_balance',
    });
    const r = await register.request(
      '/pos/sales',
      sale({
        lines: [
          { productId: p.body.id, quantity: '1', expectedPrice: '11.50', expectedTaxRate: '25' },
        ],
        payment: { method: 'cash', tendered: '11.50' },
      }),
    );
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      storeName: 'Updated Market',
      storeAddress: 'Main street 1',
      receiptFooter: 'Come again!',
      businessNumber: 'ORG-1',
    });
    await manager.request('/store-profile', {
      ...current,
      name: 'Changed again',
      receiptFooter: 'New footer',
    });
    const stored = (await manager.request('/reports/receipt-search/' + r.body.id)).body.receipt;
    expect(stored.storeName).toBe('Updated Market');
    expect(stored.receiptFooter).toBe('Come again!');
    expect((await register.request('/store-profile', current)).status).toBe(401);
  });
  it('rolls back an unfunded cash refund and conserves tax across competing partial refunds', async () => {
    const created = await manager.request('/products', {
      ...product,
      name: 'Tax rounding',
      sku: 'TAX-ROUND',
      price: '0.10',
      cost: '0.01',
      taxRate: '15',
      plu: '',
      barcodes: [],
    });
    expect(created.status).toBe(201);
    const id = created.body.id;
    await manager.request('/inventory/adjustments', {
      requestId: crypto.randomUUID(),
      productId: id,
      quantity: '3',
      reason: 'opening_balance',
    });
    const sold = await register.request(
      '/pos/sales',
      sale({
        lines: [{ productId: id, quantity: '3', expectedPrice: '0.10', expectedTaxRate: '15' }],
        discountPercent: '10',
        payment: { method: 'cash', tendered: '0.27' },
      }),
    );
    expect(sold.status).toBe(201);
    expect(sold.body.tax).toBe('0.04');
    const paidDay = (
      await db.pool.query("SELECT to_char(now() AT TIME ZONE 'Europe/Oslo','YYYY-MM-DD') AS day")
    ).rows[0].day;
    const saleReport = (
      await manager.request(`/reports/owner-dashboard?period=custom&from=${paidDay}&to=${paidDay}`)
    ).body;
    expect(saleReport.products.byRevenue.find((p: any) => p.id === id).grossProfit).toBe(0.2);
    expect(saleReport.products.byRevenue.find((p: any) => p.id === id).unitMargin).toBeCloseTo(
      ((0.09 - 0.01) / 0.09) * 100,
    );
    expect(saleReport.categories.total).toBe(saleReport.kpis.revenue.value);

    await enroll(second, 'Empty refund drawer');
    expect((await unlock(second, 'OWNER', '654321')).status).toBe(200);
    const emptyShift = (
      await second.request('/pos/shifts', { requestId: crypto.randomUUID(), openingCash: '0' })
    ).body;
    const refund = {
      requestId: crypto.randomUUID(),
      saleId: sold.body.id,
      reason: 'Return',
      method: 'cash',
      confirmed: true,
      lines: [{ productId: id, quantity: '2', restock: true }],
    };
    expect((await second.request('/pos/refunds', refund)).status).toBe(400);
    expect(
      (
        await db.pool.query('SELECT count(*)::int AS n FROM refunds WHERE sale_id=$1', [
          sold.body.id,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(
      (await db.pool.query('SELECT stock FROM products WHERE id=$1', [id])).rows[0].stock,
    ).toBe('0.000');
    expect((await second.request('/pos/context')).body.shift.expectedCash).toBe('0.00');
    expect(
      (
        await second.request('/pos/cash', {
          requestId: crypto.randomUUID(),
          direction: 'in',
          amount: '1',
          reason: 'Refund float',
        })
      ).status,
    ).toBe(201);
    const replies = await Promise.all([
      second.request('/pos/refunds', refund),
      second.request('/pos/refunds', { ...refund, requestId: crypto.randomUUID() }),
    ]);
    expect(replies.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (
        await second.request('/pos/refunds', {
          ...refund,
          requestId: crypto.randomUUID(),
          lines: [{ productId: id, quantity: '1', restock: true }],
        })
      ).status,
    ).toBe(201);
    const totals = (
      await db.pool.query(
        'SELECT sum(total)::text AS total,sum(tax)::text AS tax FROM refunds WHERE sale_id=$1',
        [sold.body.id],
      )
    ).rows[0];
    expect(totals).toEqual({ total: '0.27', tax: '0.04' });
    expect((await second.request('/pos/context')).body.shift.expectedCash).toBe('0.73');
    expect(
      (await db.pool.query('SELECT stock FROM products WHERE id=$1', [id])).rows[0].stock,
    ).toBe('3.000');
    const today = (
      await db.pool.query("SELECT to_char(now() AT TIME ZONE 'Europe/Oslo','YYYY-MM-DD') AS day")
    ).rows[0].day;
    const detailed = (await manager.request(`/reports/gross-profit?from=${today}&to=${today}`))
      .body;
    const dashboard = (
      await manager.request(`/reports/owner-dashboard?period=custom&from=${today}&to=${today}`)
    ).body;
    expect(dashboard.kpis.grossProfit.value).toBe(Number(detailed.grossProfit));
    expect(dashboard.products.byProfit.find((p: any) => p.id === id).grossProfit).toBe(0);
    expect(dashboard.categories.total).toBe(dashboard.kpis.revenue.value);
    const trend = dashboard.marginTrend.at(-1);
    expect(Number(trend.revenue)).toBe(dashboard.kpis.revenue.value);
    expect(trend.margin).toBe(Number(dashboard.kpis.grossMargin.value.toFixed(2)));

    expect(emptyShift.id).toBeTruthy();
  });
  it('records a fully discounted sale with zero tax and no cash change', async () => {
    const p = (
      await manager.request('/products', {
        ...product,
        name: 'Giveaway',
        sku: 'FREE-SALE',
        price: '9.99',
        cost: '1',
        taxRate: '20',
        plu: '',
        barcodes: [],
      })
    ).body;
    await manager.request('/inventory/adjustments', {
      requestId: crypto.randomUUID(),
      productId: p.id,
      quantity: '1',
      reason: 'opening_balance',
    });
    const before = (await second.request('/pos/context')).body.shift;
    const free = await second.request('/pos/sales', {
      requestId: crypto.randomUUID(),
      shiftId: before.id,
      lines: [{ productId: p.id, quantity: '1', expectedPrice: '9.99', expectedTaxRate: '20' }],
      discountPercent: '100',
      payment: { method: 'cash', tendered: '0' },
    });
    expect(free.status).toBe(201);
    expect(free.body).toMatchObject({ total: '0.00', tax: '0.00', discount: '9.99' });
    expect((await second.request('/pos/context')).body.shift.expectedCash).toBe(
      before.expectedCash,
    );
    expect(
      (await db.pool.query('SELECT stock FROM products WHERE id=$1', [p.id])).rows[0].stock,
    ).toBe('0.000');
  });
  it('rejects totals above the supported sale limit without recording payment or stock changes', async () => {
    const p = (
      await manager.request('/products', {
        ...product,
        name: 'Maximum price',
        sku: 'MAX-PRICE',
        price: '999999999.99',
        cost: '1',
        taxRate: '0',
        plu: '',
        barcodes: [],
      })
    ).body;
    await manager.request('/inventory/adjustments', {
      requestId: crypto.randomUUID(),
      productId: p.id,
      quantity: '2',
      reason: 'opening_balance',
    });
    const before = (await second.request('/pos/context')).body.shift;
    const requestId = crypto.randomUUID();
    const rejected = await second.request('/pos/sales', {
      requestId,
      shiftId: before.id,
      lines: [
        { productId: p.id, quantity: '2', expectedPrice: '999999999.99', expectedTaxRate: '0' },
      ],
      payment: { method: 'cash', tendered: '999999999.99' },
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.message).toMatch(/supported total/);
    expect(
      (await db.pool.query('SELECT count(*)::int AS n FROM sales WHERE request_id=$1', [requestId]))
        .rows[0].n,
    ).toBe(0);
    expect(
      (await db.pool.query('SELECT stock FROM products WHERE id=$1', [p.id])).rows[0].stock,
    ).toBe('2.000');
    expect((await second.request('/pos/context')).body.shift.expectedCash).toBe(
      before.expectedCash,
    );
  });
});
