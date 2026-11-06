import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
const admin = new Database();
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_order_delivery_test_${Date.now()}`;
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

const manager = new Client();
let supplier: any, order: any, productId: string;
const account = {
  storeName: 'Purchasing test',
  ownerName: 'Owner',
  email: 'owner@purchases.test',
  password: 'owner-password-12345',
  currency: 'NOK',
  timezone: 'Europe/Oslo',
};
const requestId = () => crypto.randomUUID();
describe.sequential('quantity-only orders and actual delivery costs', () => {
  it('places an unpriced order idempotently without stock, cost or selling-price changes', async () => {
    expect((await manager.request('/auth/setup', account)).status).toBe(201);
    supplier = (
      await manager.request('/suppliers', {
        requestId: requestId(),
        code: 'NEW',
        name: 'New supplier',
      })
    ).body;
    productId = (
      await manager.request('/products', {
        name: 'Yogurt',
        sku: 'YOG',
        category: 'Dairy',
        unit: 'piece',
        price: '30',
        taxRate: '0',
        minStock: '0',
        barcodes: [],
      })
    ).body.id;
    const body = {
      requestId: requestId(),
      supplierId: supplier.id,
      placeOrder: true,
      lines: [{ productId, quantity: '3' }],
    };
    const result = await manager.request('/purchases', body);
    expect(result.status).toBe(201);
    order = result.body;
    expect(order.status).toBe('ordered');
    expect(order.total).toBeNull();
    expect(order.lines[0].unit_cost).toBeNull();
    expect((await manager.request('/purchases', body)).body.id).toBe(order.id);
    expect(
      (await db.pool.query('SELECT stock::text,price::text FROM products WHERE id=$1', [productId]))
        .rows[0],
    ).toEqual({ stock: '0.000', price: '30.00' });
    expect(
      (
        await db.pool.query('SELECT pack_cost FROM supplier_products WHERE product_id=$1', [
          productId,
        ])
      ).rows[0].pack_cost,
    ).toBeNull();
    const active = (
      await manager.request(`/purchases?page=1&supplierId=${supplier.id}&status=active`)
    ).body;
    expect(active.total).toBe(1);
    expect(
      (await manager.request(`/purchases?page=1&supplierId=${supplier.id}&status=delivered`)).body
        .total,
    ).toBe(0);
  });
  it('rejects missing costs and rolls back a partially delivered order marked fully paid', async () => {
    const missing = await manager.request(`/purchases/${order.id}/receipts`, {
      requestId: requestId(),
      version: order.version,
      lines: [{ purchaseLineId: order.lines[0].id, quantity: '1' }],
    });
    expect(missing.status).toBe(400);
    const paidPartial = await manager.request(`/purchases/${order.id}/receipts`, {
      requestId: requestId(),
      version: order.version,
      paymentStatus: 'paid',
      lines: [{ purchaseLineId: order.lines[0].id, quantity: '1', unitCost: '8' }],
    });
    expect(paidPartial.status).toBe(400);
    expect(
      (await db.pool.query('SELECT stock::text FROM products WHERE id=$1', [productId])).rows[0]
        .stock,
    ).toBe('0.000');
    expect(
      (
        await db.pool.query(
          'SELECT count(*)::int AS count FROM goods_receipts WHERE purchase_id=$1',
          [order.id],
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it('records actual costs and tax by batch, keeping partial deliveries active', async () => {
    const body = {
      requestId: requestId(),
      version: order.version,
      paymentStatus: 'unpaid',
      paymentDueDate: '2030-12-01',
      lines: [{ purchaseLineId: order.lines[0].id, quantity: '1', unitCost: '8', taxRate: '15' }],
    };
    const result = await manager.request(`/purchases/${order.id}/receipts`, body);
    expect(result.status).toBe(201);
    order = result.body;
    expect(order.status).toBe('partially_received');
    expect(order.total).toBeNull();
    expect(order.receipts[0].total).toBe('9.20');
    expect((await manager.request(`/purchases/${order.id}/receipts`, body)).body.version).toBe(
      order.version,
    );
    expect(
      (await manager.request(`/purchases?page=1&supplierId=${supplier.id}&status=active`)).body
        .total,
    ).toBe(1);
  });
  it('finalizes the actual received amount and paid status atomically on the final delivery', async () => {
    const result = await manager.request(`/purchases/${order.id}/receipts`, {
      requestId: requestId(),
      version: order.version,
      paymentStatus: 'paid',
      lines: [
        {
          purchaseLineId: order.lines[0].id,
          quantity: '2',
          unitCost: '10',
          taxRate: '15',
          sellingPrice: '35',
          expectedSellingPrice: '30',
        },
      ],
    });
    expect(result.status).toBe(201);
    order = result.body;
    expect(order.status).toBe('received');
    expect(order.total).toBe('32.20');
    expect(order.payment_status).toBe('paid');
    expect(order.paid_at).toBeTruthy();
    expect(
      (await db.pool.query('SELECT stock::text,price::text FROM products WHERE id=$1', [productId]))
        .rows[0],
    ).toEqual({ stock: '3.000', price: '35.00' });
    expect(
      (
        await db.pool.query(
          'SELECT unit_cost::text,quantity::text FROM stock_batches WHERE product_id=$1 ORDER BY created_at,id',
          [productId],
        )
      ).rows,
    ).toEqual([
      { unit_cost: '8.00', quantity: '1.000' },
      { unit_cost: '10.00', quantity: '2.000' },
    ]);
    expect(
      (await manager.request(`/purchases?page=1&supplierId=${supplier.id}&status=active`)).body
        .total,
    ).toBe(0);
    expect(
      (await manager.request(`/purchases?page=1&supplierId=${supplier.id}&status=delivered`)).body
        .total,
    ).toBe(1);
  });
  it('finalizes only actual receipts when the remaining quantity is closed', async () => {
    let partial = (
      await manager.request('/purchases', {
        requestId: requestId(),
        supplierId: supplier.id,
        placeOrder: true,
        lines: [{ productId, quantity: '5' }],
      })
    ).body;
    partial = (
      await manager.request(`/purchases/${partial.id}/receipts`, {
        requestId: requestId(),
        version: partial.version,
        lines: [{ purchaseLineId: partial.lines[0].id, quantity: '2', unitCost: '7' }],
      })
    ).body;
    const closed = await manager.request(`/purchases/${partial.id}/close-remainder`, {
      requestId: requestId(),
      version: partial.version,
      reason: 'Supplier cannot deliver the rest',
    });
    expect(closed.status).toBe(201);
    expect(closed.body.total).toBe('14.00');
    expect(closed.body.status).toBe('closed');
    expect(closed.body.lines[0].received_quantity).toBe('2.000');
  });
});
