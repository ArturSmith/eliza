import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';

const admin = new Database();
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_price_actions_${Date.now()}`;
let db: Database, app: Awaited<ReturnType<typeof createApp>>, url: string;
class Client {
  cookies = new Map<string, string>();
  async request(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(url + '/api' + path, {
      method,
      headers: {
        Origin: 'http://localhost:5173',
        'X-Eliza-Request': '1',
        'Content-Type': 'application/json',
        Cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [key, value] = cookie.split(';')[0].split('=');
      if (value) this.cookies.set(key, value);
      else this.cookies.delete(key);
    }
    return { status: response.status, body: await response.json() };
  }
}
const manager = new Client(),
  register = new Client();
let productId: string, shiftId: string, shortBatchId: string;
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Oslo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
function sale(
  lines: { productId: string; quantity: string; expectedPrice: string; expectedTaxRate: string }[],
  total: string,
) {
  return {
    requestId: crypto.randomUUID(),
    shiftId,
    lines,
    discountPercent: '0',
    payment: { method: 'card', tendered: total },
  };
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
describe.sequential('manager price actions', () => {
  it('sets up distinct cost batches and an owner-operated register', async () => {
    const account = {
      storeName: 'Pricing test',
      ownerName: 'Owner',
      email: 'owner@pricing.test',
      password: 'owner-password-12345',
      currency: 'NOK',
      timezone: 'Europe/Oslo',
    };
    expect((await manager.request('/auth/setup', account)).status).toBe(201);
    const owner = (await manager.request('/auth/session')).body.user.id;
    const ownerRole = (await manager.request('/team/roles')).body.find(
      (role: { name: string }) => role.name === 'Owner',
    ).id;
    expect(
      (
        await manager.request(
          `/team/${owner}`,
          { name: 'Owner', employeeCode: 'OWNER', roleId: ownerRole, active: true, pin: '654321' },
          'PATCH',
        )
      ).status,
    ).toBe(200);
    productId = (
      await manager.request('/products', {
        name: 'Yogurt',
        sku: 'YOGURT',
        category: 'Dairy',
        unit: 'piece',
        price: '70.00',
        cost: '59.00',
        taxRate: '0',
        minStock: '0',
        plu: '',
        barcodes: ['709000000009'],
      })
    ).body.id;
    const store = (await db.pool.query('SELECT store_id FROM products WHERE id=$1', [productId]))
      .rows[0].store_id;
    await db.pool.query(
      `INSERT INTO stock_batches(store_id,product_id,quantity,unit_cost,cost_source)
       VALUES($1,$2,7,59,'adjustment')`,
      [store, productId],
    );
    shortBatchId = (
      await db.pool.query(
        `INSERT INTO stock_batches(store_id,product_id,expiry_date,quantity,unit_cost,cost_source)
       VALUES($1,$2,CURRENT_DATE+3,3,60,'adjustment') RETURNING id`,
        [store, productId],
      )
    ).rows[0].id;
    await db.pool.query('UPDATE products SET stock=10 WHERE id=$1', [productId]);
    expect(
      (await register.request('/auth/login', { email: account.email, password: account.password }))
        .status,
    ).toBe(200);
    expect((await register.request('/pos/enroll', { name: 'Pricing register' })).status).toBe(201);
    expect(
      (await register.request('/pos/login', { employeeCode: 'OWNER', pin: '654321' })).status,
    ).toBe(200);
    shiftId = (
      await register.request('/pos/shifts', { requestId: crypto.randomUUID(), openingCash: '0' })
    ).body.id;
  });
  it('limits a relabelled barcode to selected stock and preserves batch cost', async () => {
    const details = await manager.request(`/products/${productId}/pricing`);
    expect(details.status).toBe(200);
    expect(details.body.batches).toHaveLength(2);
    expect(
      (
        await manager.request(`/products/${productId}/pricing/limited`, {
          requestId: crypto.randomUUID(),
          batchId: shortBatchId,
          quantity: 4,
          price: '50.00',
        })
      ).status,
    ).toBe(409);
    const request = {
      requestId: crypto.randomUUID(),
      batchId: shortBatchId,
      quantity: 3,
      price: '50.00',
    };
    const created = await manager.request(`/products/${productId}/pricing/limited`, request);
    expect(created.status).toBe(201);
    const offer = created.body;
    expect((await manager.request(`/products/${productId}/pricing/limited`, request)).body).toEqual(
      offer,
    );
    expect((await manager.request('/inventory/adjustments', {
      productId: offer.id, quantity: '1', reason: 'count_correction', requestId: crypto.randomUUID(),
    })).status).toBe(400);
    expect(offer.barcode).toMatch(/^04\d{11}$/);
    expect((await register.request(`/pos/products?code=${offer.barcode}`)).body).toMatchObject([
      { id: offer.id, price: '50.00', regularPrice: '70.00', stock: '3.000' },
    ]);
    const remaining = await db.pool.query('SELECT stock FROM products WHERE id=$1', [productId]);
    expect(remaining.rows[0].stock).toBe('7.000');
    const first = await register.request(
      '/pos/sales',
      sale(
        [
          { productId, quantity: '1', expectedPrice: '70.00', expectedTaxRate: '0.00' },
          { productId: offer.id, quantity: '1', expectedPrice: '50.00', expectedTaxRate: '0.00' },
        ],
        '120.00',
      ),
    );
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ subtotal: '140.00', discount: '20.00', total: '120.00' });
    const costs = (
      await db.pool.query('SELECT product_id,cost_total FROM sale_items WHERE sale_id=$1', [
        first.body.id,
      ])
    ).rows;
    expect(costs.find((item) => item.product_id === offer.id).cost_total).toBe('60.00');
    expect(costs.find((item) => item.product_id === productId).cost_total).toBe('59.00');
    const attempts = await Promise.all(
      [1, 2].map(() =>
        register.request(
          '/pos/sales',
          sale(
            [
              {
                productId: offer.id,
                quantity: '2',
                expectedPrice: '50.00',
                expectedTaxRate: '0.00',
              },
            ],
            '100.00',
          ),
        ),
      ),
    );
    expect(attempts.map((result) => result.status).sort()).toEqual([201, 409]);
    expect((await register.request(`/pos/products?code=${offer.barcode}`)).body[0].stock).toBe(
      '0.000',
    );
    const refund = await register.request('/pos/refunds', {
      requestId: crypto.randomUUID(),
      saleId: first.body.id,
      reason: 'Returned one yogurt',
      method: 'card',
      confirmed: true,
      lines: [{ productId: offer.id, quantity: '1', restock: true }],
    });
    expect(refund.status).toBe(201);
    expect((await register.request(`/pos/products?code=${offer.barcode}`)).body[0].stock).toBe(
      '1.000',
    );
    const restockCost = (
      await db.pool.query('SELECT unit_cost FROM stock_batches WHERE product_id=$1', [offer.id])
    ).rows[0].unit_cost;
    expect(restockCost).toBe('60.00');
  });
  it('distinguishes a product-wide discount from a permanent price change in reports', async () => {
    expect(
      (
        await manager.request(`/products/${productId}/pricing`, {
          kind: 'discount_all',
          price: '60.00',
        })
      ).status,
    ).toBe(201);
    const catalog = await register.request('/pos/products?code=709000000009');
    expect(catalog.body[0]).toMatchObject({ price: '60.00', regularPrice: '70.00' });
    const paid = await register.request(
      '/pos/sales',
      sale(
        [{ productId, quantity: '1', expectedPrice: '60.00', expectedTaxRate: '0.00' }],
        '60.00',
      ),
    );
    expect(paid.status).toBe(201);
    expect(paid.body).toMatchObject({ subtotal: '70.00', discount: '10.00', total: '60.00' });
    const range = `from=${today}&to=${today}&productId=${productId}`;
    const profit = await manager.request(`/reports/gross-profit?${range}`);
    expect(profit.status).toBe(200);
    expect(profit.body).toMatchObject({
      netRevenue: '230.00',
      costOfGoodsSold: '238.00',
      grossProfit: '-8.00',
    });
    const analytics = await manager.request(`/reports/analytics?${range}`);
    expect(analytics.status).toBe(200);
    expect(analytics.body.totals).toMatchObject({
      total: '280.00',
      refunds: '50.00',
      net: '230.00',
    });
    const overview = await manager.request('/reports/owner-dashboard?period=today');
    expect(overview.status).toBe(200);
    expect(overview.body.readiness.products).toBe(1);
    expect(overview.body.products.all).toBe(1);
    expect(overview.body.kpis.grossProfit.value).toBe(-8);
    const version = (
      await db.pool.query('SELECT tag_price_version FROM products WHERE id=$1', [productId])
    ).rows[0].tag_price_version;
    expect(
      (await manager.request(`/products/${productId}/pricing`, { kind: 'regular', price: '60.00' }))
        .status,
    ).toBe(201);
    const changed = (
      await db.pool.query('SELECT tag_price_version FROM products WHERE id=$1', [productId])
    ).rows[0].tag_price_version;
    expect(changed).toBe(version + 1);
    expect(
      (await manager.request(`/products/${productId}/pricing`, { kind: 'regular', price: '65.00' }))
        .status,
    ).toBe(201);
    expect((await register.request('/pos/products?code=709000000009')).body[0]).toMatchObject({
      price: '65.00',
      regularPrice: null,
    });
  });
});
