import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';

const admin = new Database();
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_price_check_${Date.now()}`;
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
  checker = new Client(),
  stranger = new Client();
let deviceId: string;
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
describe.sequential('customer price checker', () => {
  it('requires an active device assigned to the price checker', async () => {
    expect((await stranger.request('/price-check/context')).status).toBe(401);
    const account = {
      storeName: 'Test shop',
      ownerName: 'Owner',
      email: 'owner@price-check.test',
      password: 'owner-password-12345',
      currency: 'NOK',
      timezone: 'Europe/Oslo',
    };
    expect((await manager.request('/auth/setup', account)).status).toBe(201);
    expect(
      (await checker.request('/auth/login', { email: account.email, password: account.password }))
        .status,
    ).toBe(200);
    deviceId = (await checker.request('/auth/session')).body.device.id;
    expect((await checker.request('/price-check/context')).status).toBe(403);
    expect(
      (
        await manager.request(
          `/devices/${deviceId}`,
          {
            name: 'Shop floor price checker',
            active: true,
            type: 'price_check',
          },
          'PATCH',
        )
      ).status,
    ).toBe(200);
    expect((await checker.request('/price-check/context')).body).toMatchObject({
      storeName: 'Test shop',
      currency: 'NOK',
    });
    expect((await checker.request('/products')).status).toBe(401);
  });

  it('shows the current product promotion and one-use markdown price', async () => {
    const product = await manager.request('/products', {
      name: 'Yogurt',
      description: 'Plain yogurt with live cultures.',
      image: 'data:image/jpeg;base64,/9j/2Q==',
      source: {
        barcode: '709000000039',
        brand: 'Farmhouse',
        quantity: '500 g',
        imageImported: false,
      },
      sku: 'CHECK-YOGURT',
      category: 'Dairy',
      unit: 'piece',
      price: '70.00',
      cost: '59.00',
      taxRate: '0',
      minStock: '0',
      plu: '',
      barcodes: ['709000000039'],
    });
    expect(product.status).toBe(201);
    const productId = product.body.id;
    const storeId = (await db.pool.query('SELECT store_id FROM products WHERE id=$1', [productId]))
      .rows[0].store_id;
    await db.pool.query(
      "INSERT INTO stock_batches(store_id,product_id,quantity,unit_cost,cost_source) VALUES($1,$2,3,59,'adjustment')",
      [storeId, productId],
    );
    const publicProduct = (await checker.request('/price-check/lookup?code=709000000039')).body;
    expect(publicProduct).toMatchObject({
      name: 'Yogurt',
      description: 'Plain yogurt with live cultures.',
      image: 'data:image/jpeg;base64,/9j/2Q==',
      category: 'Dairy',
      brand: 'Farmhouse',
      packageQuantity: '500 g',
      barcode: '709000000039',
      unit: 'piece',
      price: '70.00',
      regularPrice: null,
    });
    for (const privateField of ['cost', 'stock', 'sku', 'plu', 'taxRate', 'source', 'category_id'])
      expect(publicProduct).not.toHaveProperty(privateField);
    expect((await checker.request('/price-check/lookup?code=000000000000')).status).toBe(404);
    const promo = await manager.request('/promotions', {
      name: 'Yogurt promotion',
      discountType: 'FIXED_PRICE',
      discountValue: '60.00',
      productIds: [productId],
      categoryIds: [],
    });
    expect(promo.status).toBe(201);
    expect((await checker.request('/price-check/lookup?code=709000000039')).body).toMatchObject({
      price: '60.00',
      regularPrice: '70.00',
      discountType: 'promotion',
    });
    const markdown = await manager.request(`/products/${productId}/pricing/limited`, {
      requestId: crypto.randomUUID(),
      quantity: 1,
      price: '55.00',
      reason: 'EXPIRING_SOON',
    });
    expect(markdown.status).toBe(201);
    const label = markdown.body.labels[0];
    expect((await checker.request('/price-check/lookup?code=' + label.barcode)).body).toMatchObject(
      {
        price: '55.00',
        regularPrice: '70.00',
        discountType: 'markdown',
      },
    );
    expect(
      (await manager.request(`/products/${productId}/pricing/markdowns/${label.id}/cancel`, {}))
        .status,
    ).toBe(201);
    expect((await checker.request('/price-check/lookup?code=' + label.barcode)).status).toBe(404);
  });

  it('blocks lookups immediately when the device is disabled', async () => {
    expect(
      (
        await manager.request(
          `/devices/${deviceId}`,
          {
            name: 'Shop floor price checker',
            active: false,
            type: 'price_check',
          },
          'PATCH',
        )
      ).status,
    ).toBe(200);
    expect((await checker.request('/price-check/lookup?code=709000000039')).status).toBe(403);
  });
});
