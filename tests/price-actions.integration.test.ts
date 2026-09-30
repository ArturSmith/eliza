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
  it('creates unique one-use markdown labels without changing physical stock', async () => {
    const failed = await manager.request(`/products/${productId}/pricing/limited`, {
      requestId: crypto.randomUUID(),
      quantity: 11,
      price: '50.00',
      reason: 'EXPIRING_SOON',
    });
    expect(failed.status).toBe(409);
    const request = {
      requestId: crypto.randomUUID(),
      quantity: 4,
      price: '50.00',
      reason: 'EXPIRING_SOON',
    };
    const created = await manager.request(`/products/${productId}/pricing/limited`, request);
    expect(created.status).toBe(201);
    const labels = created.body.labels as { id: string; barcode: string }[];
    expect(labels).toHaveLength(4);
    expect(new Set(labels.map((l) => l.barcode)).size).toBe(4);
    expect(labels.every((l) => /^05\d{11}$/.test(l.barcode))).toBe(true);
    expect((await manager.request(`/products/${productId}/pricing/limited`, request)).body).toEqual(
      created.body,
    );
    const batches = (
      await db.pool.query('SELECT batch_id FROM markdown_units WHERE markdown_id=$1 ORDER BY id', [
        created.body.markdownId,
      ])
    ).rows;
    expect(batches.filter((b) => b.batch_id === shortBatchId)).toHaveLength(3);
    expect(
      (await db.pool.query('SELECT stock::text FROM products WHERE id=$1', [productId])).rows[0]
        .stock,
    ).toBe('10.000');
    expect(
      (await register.request('/pos/catalog')).body.products.find(
        (p: { id: string }) => p.id === productId,
      ).stock,
    ).toBe('6.000');
    expect(
      (
        await manager.request('/inventory/adjustments', {
          productId,
          quantity: '-7',
          reason: 'count_correction',
          requestId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(409);
    const label = labels[0];
    const scan = await register.request(`/pos/products?code=${label.barcode}`);
    expect(scan.body).toMatchObject([
      {
        id: productId,
        price: '50.00',
        regularPrice: '70.00',
        stock: '1.000',
        markdownUnitId: label.id,
      },
    ]);
    expect((await register.request(`/pos/products?code=${label.barcode.slice(1)}`)).body).toEqual(
      scan.body,
    );
    await db.pool.query(
      'INSERT INTO barcodes(store_id,product_id,value) SELECT store_id,id,$2 FROM products WHERE id=$1',
      [productId, label.barcode.slice(1)],
    );
    expect(
      (await register.request(`/pos/products?code=${label.barcode.slice(1)}`)).body,
    ).toMatchObject([{ id: productId, price: '70.00' }]);
    await db.pool.query('DELETE FROM barcodes WHERE product_id=$1 AND value=$2', [
      productId,
      label.barcode.slice(1),
    ]);
    expect(
      (await register.request(`/pos/catalog?search=${label.barcode}`)).body.products,
    ).toMatchObject([{ markdownUnitId: label.id, price: '50.00' }]);
    const first = await register.request(
      '/pos/sales',
      sale(
        [
          { productId, quantity: '1', expectedPrice: '70.00', expectedTaxRate: '0.00' },
          {
            productId,
            quantity: '1',
            expectedPrice: '50.00',
            expectedTaxRate: '0.00',
            markdownUnitId: label.id,
          },
        ] as any,
        '120.00',
      ),
    );
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ subtotal: '140.00', discount: '20.00', total: '120.00' });
    const line = (
      await db.pool.query(
        'SELECT id,cost_total::text,pricing_source,base_unit_price::text FROM sale_items WHERE markdown_unit_id=$1',
        [label.id],
      )
    ).rows[0];
    expect(line).toMatchObject({ pricing_source: 'MARKDOWN', base_unit_price: '70.00' });
    expect(['59.00', '60.00']).toContain(line.cost_total);
    const repeat = await register.request(
      '/pos/sales',
      sale(
        [
          {
            productId,
            quantity: '1',
            expectedPrice: '50.00',
            expectedTaxRate: '0.00',
            markdownUnitId: label.id,
          },
        ] as any,
        '50.00',
      ),
    );
    expect(repeat.status).toBe(409);
    expect((await register.request(`/pos/products?code=${label.barcode}`)).status).toBe(409);
    const refund = await register.request('/pos/refunds', {
      requestId: crypto.randomUUID(),
      saleId: first.body.id,
      reason: 'Returned markdown yogurt',
      method: 'card',
      confirmed: true,
      lines: [{ productId, saleItemId: line.id, quantity: '1', restock: true }],
    });
    expect(refund.status).toBe(201);
    expect(refund.body.total).toBe('50.00');
    const restored = (
      await db.pool.query('SELECT restored_cost::text FROM refund_lines WHERE sale_item_id=$1', [
        line.id,
      ])
    ).rows[0];
    expect(restored.restored_cost).toBe(line.cost_total);
    expect(
      (await db.pool.query('SELECT status FROM markdown_units WHERE id=$1', [label.id])).rows[0]
        .status,
    ).toBe('SOLD');
    const remaining = labels.find((l) => l.id !== label.id)!;
    const replaced = await manager.request(
      `/products/${productId}/pricing/markdowns/${remaining.id}/replace`,
      {},
    );
    expect(replaced.status).toBe(201);
    expect(replaced.body.label.barcode).not.toBe(remaining.barcode);
    const markdownHistory = (await manager.request(`/products/${productId}/pricing/markdowns`))
      .body;
    expect(markdownHistory.find((unit: any) => unit.id === remaining.id).status).toBe('CANCELLED');
    expect(markdownHistory.find((unit: any) => unit.id === replaced.body.label.id)).toMatchObject({
      status: 'AVAILABLE',
      replacementForId: remaining.id,
    });
    expect((await register.request(`/pos/products?code=${remaining.barcode}`)).status).toBe(409);
    expect(
      (await register.request(`/pos/products?code=${remaining.barcode.slice(1)}`)).status,
    ).toBe(409);
    const cancelled = await manager.request(
      `/products/${productId}/pricing/markdowns/${replaced.body.label.id}/cancel`,
      {},
    );
    expect(cancelled.status).toBe(201);
  });
  it('applies non-stacking category and product promotions and snapshots margin', async () => {
    const category = (await manager.request('/promotions/categories')).body.find(
      (c: { name: string }) => c.name === 'Dairy',
    );
    expect(category?.id).toBeTruthy();
    const categoryPromo = await manager.request('/promotions', {
      name: 'Dairy week',
      discountType: 'PERCENTAGE',
      discountValue: '20.00',
      categoryIds: [category.id],
      productIds: [],
    });
    expect(categoryPromo.status).toBe(201);
    const productPromo = await manager.request('/promotions', {
      name: 'Yogurt fixed',
      discountType: 'FIXED_PRICE',
      discountValue: '60.00',
      categoryIds: [],
      productIds: [productId],
    });
    expect(productPromo.status).toBe(201);
    expect((await register.request('/pos/products?code=709000000009')).body[0]).toMatchObject({
      price: '56.00',
      regularPrice: '70.00',
      priceSource: 'CATEGORY_PROMOTION',
    });
    const paid = await register.request(
      '/pos/sales',
      sale(
        [{ productId, quantity: '1', expectedPrice: '56.00', expectedTaxRate: '0.00' }],
        '56.00',
      ),
    );
    expect(paid.status).toBe(201);
    expect(paid.body).toMatchObject({ subtotal: '70.00', discount: '14.00', total: '56.00' });
    const snapshot = (
      await db.pool.query(
        'SELECT pricing_source,promotion_id,price::text,total::text,cost_total::text FROM sale_items WHERE sale_id=$1',
        [paid.body.id],
      )
    ).rows[0];
    expect(snapshot).toMatchObject({
      pricing_source: 'CATEGORY_PROMOTION',
      promotion_id: categoryPromo.body.id,
      price: '56.00',
      total: '56.00',
    });
    expect(['59.00', '60.00']).toContain(snapshot.cost_total);
    const cancelled = await manager.request(`/promotions/${categoryPromo.body.id}/cancel`, {});
    expect(cancelled.status).toBe(201);
    expect((await register.request('/pos/products?code=709000000009')).body[0]).toMatchObject({
      price: '60.00',
      priceSource: 'PRODUCT_PROMOTION',
    });
    const stale = await register.request(
      '/pos/sales',
      sale(
        [{ productId, quantity: '1', expectedPrice: '56.00', expectedTaxRate: '0.00' }],
        '56.00',
      ),
    );
    expect(stale.status).toBe(409);
    const range = `from=${today}&to=${today}&productId=${productId}`;
    const profit = await manager.request(`/reports/gross-profit?${range}`);
    expect(profit.status).toBe(200);
    expect(Number(profit.body.netRevenue)).toBeGreaterThan(0);
    expect(Number(profit.body.costOfGoodsSold)).toBeGreaterThan(0);
    const sourceReport = await manager.request('/reports/pricing-sources?period=today');
    expect(sourceReport.status).toBe(200);
    expect(
      sourceReport.body.find((row: { source: string }) => row.source === 'CATEGORY_PROMOTION'),
    ).toMatchObject({
      revenue: '56.00',
      discount: '14.00',
      grossProfit: String(56 - Number(snapshot.cost_total) - 0) + '.00',
    });
    const markdown = await manager.request(`/products/${productId}/pricing/limited`, {
      requestId: crypto.randomUUID(),
      quantity: 1,
      price: '50.00',
      reason: 'EXPIRING_SOON',
    });
    expect(markdown.status).toBe(201);
    expect(markdown.body.labels[0]).toMatchObject({ price: '50.00', regularPrice: '70.00' });
    const markdownPrice = (
      await db.pool.query(
        'SELECT base_unit_price::text,original_unit_price::text FROM markdowns WHERE id=$1',
        [markdown.body.markdownId],
      )
    ).rows[0];
    expect(markdownPrice).toMatchObject({
      base_unit_price: '60.00',
      original_unit_price: '70.00',
    });
    expect(
      (await register.request(`/pos/products?code=${markdown.body.labels[0].barcode}`)).body,
    ).toMatchObject([
      {
        price: '50.00',
        regularPrice: '70.00',
        markdownUnitId: markdown.body.labels[0].id,
      },
    ]);
    const markedSale = await register.request(
      '/pos/sales',
      sale(
        [
          {
            productId,
            quantity: '1',
            expectedPrice: '50.00',
            expectedTaxRate: '0.00',
            markdownUnitId: markdown.body.labels[0].id,
          },
        ] as any,
        '50.00',
      ),
    );
    expect(markedSale.status).toBe(201);
    expect(markedSale.body).toMatchObject({ subtotal: '70.00', discount: '20.00', total: '50.00' });
    expect(markedSale.body.lines[0]).toMatchObject({
      baseUnitPrice: '70.00',
      gross: '70.00',
      discount: '20.00',
      total: '50.00',
    });
    const markedSnapshot = (
      await db.pool.query(
        'SELECT base_unit_price::text,cost_total::text,discount_total::text FROM sale_items WHERE sale_id=$1',
        [markedSale.body.id],
      )
    ).rows[0];
    expect(markedSnapshot.base_unit_price).toBe('70.00');
    expect(markedSnapshot.discount_total).toBe('20.00');
    expect(['59.00', '60.00']).toContain(markedSnapshot.cost_total);
  });
  it('applies category rules to later products and never raises a cheap item price', async () => {
    const store = (await db.pool.query('SELECT store_id FROM products WHERE id=$1', [productId]))
      .rows[0].store_id;
    const category = (await manager.request('/promotions/categories')).body.find(
      (c: { name: string }) => c.name === 'Dairy',
    );
    const fixed = await manager.request('/promotions', {
      name: 'Dairy fixed',
      discountType: 'FIXED_PRICE',
      discountValue: '40.00',
      categoryIds: [category.id],
      productIds: [],
    });
    expect(fixed.status).toBe(201);
    const percent = await manager.request('/promotions', {
      name: 'Dairy ten percent',
      discountType: 'PERCENTAGE',
      discountValue: '10.00',
      categoryIds: [category.id],
      productIds: [],
    });
    expect(percent.status).toBe(201);
    const future = await manager.request('/promotions', {
      name: 'Tomorrow',
      discountType: 'FIXED_PRICE',
      discountValue: '1.00',
      categoryIds: [],
      productIds: [productId],
      startsAt: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(future.status).toBe(201);
    const cheap = await manager.request('/products', {
      name: 'Milk',
      sku: 'MILK-PRICING',
      category: 'Dairy',
      unit: 'piece',
      price: '10.00',
      cost: '3.00',
      taxRate: '0',
      minStock: '0',
      plu: '',
      barcodes: ['709000000010'],
    });
    expect(cheap.status).toBe(201);
    await db.pool.query(
      `INSERT INTO stock_batches(store_id,product_id,quantity,unit_cost,cost_source)
       VALUES($1,$2,2,3,'adjustment')`,
      [store, cheap.body.id],
    );
    await db.pool.query('UPDATE products SET stock=2 WHERE id=$1', [cheap.body.id]);
    expect((await register.request('/pos/products?code=709000000010')).body[0]).toMatchObject({
      price: '9.00',
      priceSource: 'CATEGORY_PROMOTION',
    });
    expect((await register.request('/pos/products?code=709000000009')).body[0]).toMatchObject({
      price: '40.00',
      priceSource: 'CATEGORY_PROMOTION',
    });
    const tie = await manager.request('/promotions', {
      name: 'Yogurt tie',
      discountType: 'FIXED_PRICE',
      discountValue: '40.00',
      categoryIds: [],
      productIds: [productId],
    });
    expect(tie.status).toBe(201);
    expect((await register.request('/pos/products?code=709000000009')).body[0]).toMatchObject({
      price: '40.00',
      priceSource: 'PRODUCT_PROMOTION',
      promotionId: tie.body.id,
    });
    const available = (await manager.request(`/products/${productId}/pricing/markdowns`)).body.find(
      (u: { status: string }) => u.status === 'AVAILABLE',
    );
    expect(available).toBeTruthy();
    const attempts = await Promise.all(
      [1, 2].map(() =>
        register.request(
          '/pos/sales',
          sale(
            [
              {
                productId,
                quantity: '1',
                expectedPrice: '50.00',
                expectedTaxRate: '0.00',
                markdownUnitId: available.id,
              },
            ] as any,
            '50.00',
          ),
        ),
      ),
    );
    expect(attempts.map((a) => a.status).sort()).toEqual([201, 409]);
  });
  it('replaces only the quick product discount without cancelling manager rules', async () => {
    const first = await manager.request(`/products/${productId}/pricing`, {
      kind: 'discount_all',
      price: '35.00',
    });
    expect(first.status).toBe(201);
    expect((await register.request('/pos/products?code=709000000009')).body[0]).toMatchObject({
      price: '35.00',
      priceSource: 'PRODUCT_PROMOTION',
    });
    const second = await manager.request(`/products/${productId}/pricing`, {
      kind: 'discount_all',
      price: '38.00',
    });
    expect(second.status).toBe(201);
    expect((await register.request('/pos/products?code=709000000009')).body[0]).toMatchObject({
      price: '38.00',
      priceSource: 'PRODUCT_PROMOTION',
    });
    const rules = (await manager.request('/promotions')).body;
    expect(rules.find((r: { id: string }) => r.id === first.body.id).cancelledAt).toBeTruthy();
    expect(rules.find((r: { id: string }) => r.id === second.body.id).cancelledAt).toBeNull();
    expect(rules.find((r: { name: string }) => r.name === 'Yogurt tie').cancelledAt).toBeNull();
  });
});
