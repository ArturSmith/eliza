import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';

const admin = new Database();
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_supplier_products_test_${Date.now()}`;
let db: InstanceType<typeof Database>, app: Awaited<ReturnType<typeof createApp>>, url: string;

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
const account = {
  storeName: 'Supplier catalogue test',
  ownerName: 'Owner',
  email: 'owner@pos.test',
  password: 'owner-password-12345',
  currency: 'NOK',
  timezone: 'Europe/Oslo',
};
let productId: string, caseSupplier: string, singleSupplier: string, offerId: string;

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

const uuid = () => crypto.randomUUID();

describe.sequential('supplier product catalogue', () => {
  it('creates two suppliers offering the same product', async () => {
    expect((await owner.request('/auth/setup', account)).status).toBe(201);
    productId = (
      await owner.request('/products', {
        name: 'Nutella',
        sku: 'NUT',
        category: 'Grocery',
        unit: 'piece',
        price: '40.00',
        cost: '20.00',
        taxRate: '15',
        minStock: '2',
        plu: '301',
        barcodes: ['700301'],
      })
    ).body.id;
    caseSupplier = (
      await owner.request('/suppliers', { requestId: uuid(), code: 'CASE', name: 'Case Wholesale' })
    ).body.id;
    singleSupplier = (
      await owner.request('/suppliers', {
        requestId: uuid(),
        code: 'SINGLE',
        name: 'Corner Single',
      })
    ).body.id;
    expect(caseSupplier).toBeTruthy();
    expect(singleSupplier).toBeTruthy();
  });

  it('links one product to both suppliers', async () => {
    const a = await owner.request('/supplier-products', {
      requestId: uuid(),
      supplierId: caseSupplier,
      productId,
      supplierSku: 'W-NUT-12',
      packSize: '12',
      packCost: '250.00',
      leadTimeDays: 3,
    });
    expect(a.status).toBe(201);
    offerId = a.body.id;
    const b = await owner.request('/supplier-products', {
      requestId: uuid(),
      supplierId: singleSupplier,
      productId,
      packSize: '1',
      packCost: '22.00',
    });
    expect(b.status).toBe(201);
  });

  it('ranks by cost per selling unit, not by pack price', async () => {
    const res = await owner.request(`/products/${productId}/suppliers`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // 250.00 for 12 is 20.8333 each, which beats 22.00 for one.
    expect(res.body[0].supplierName).toBe('Case Wholesale');
    expect(res.body[0].unitCost).toBe('20.8333');
    expect(res.body[0].cheapest).toBe(true);
    expect(res.body[1].cheapest).toBe(false);
    expect(res.body[1].premiumPercent).toBeCloseTo(5.6, 1);
  });

  it('lists what a supplier can supply', async () => {
    const res = await owner.request(`/suppliers/${caseSupplier}/products`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].productName).toBe('Nutella');
    expect(res.body[0].supplierSku).toBe('W-NUT-12');
    expect(res.body[0].leadTimeDays).toBe(3);
    // Must be present, not undefined: the catalogue renders this directly and a
    // missing field previously crashed the page.
    expect(res.body[0].unitCost).toBe('20.8333');
  });

  it('returns the same fields from both catalogue endpoints', async () => {
    const [fromSupplier] = (await owner.request(`/suppliers/${caseSupplier}/products`)).body;
    const fromProduct = (await owner.request(`/products/${productId}/suppliers`)).body.find(
      (o: any) => o.supplierId === caseSupplier,
    );
    // Either view can render any field, so neither may omit one the other has.
    expect(Object.keys(fromSupplier).sort()).toEqual(Object.keys(fromProduct).sort());
  });

  it('records a history entry for the opening quote', async () => {
    const res = await owner.request(`/supplier-products/${offerId}/history`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].packCost).toBe('250.00');
  });

  it('appends a history entry when the quoted price moves', async () => {
    const current = (await owner.request(`/suppliers/${caseSupplier}/products`)).body[0];
    const update = await owner.request('/supplier-products', {
      requestId: uuid(),
      id: offerId,
      version: current.version,
      supplierId: caseSupplier,
      productId,
      supplierSku: 'W-NUT-12',
      packSize: '12',
      packCost: '268.00',
    });
    expect(update.status).toBe(201);
    const history = (await owner.request(`/supplier-products/${offerId}/history`)).body;
    expect(history).toHaveLength(2);
    expect(history[0].packCost).toBe('268.00');
    expect(history[0].employeeName).toBe('Owner');
  });

  it('does not record history when the price is unchanged', async () => {
    const current = (await owner.request(`/suppliers/${caseSupplier}/products`)).body[0];
    await owner.request('/supplier-products', {
      requestId: uuid(),
      id: offerId,
      version: current.version,
      supplierId: caseSupplier,
      productId,
      supplierSku: 'W-NUT-12',
      packSize: '12',
      packCost: '268.00',
      notes: 'Rep changed, price held',
    });
    const history = (await owner.request(`/supplier-products/${offerId}/history`)).body;
    expect(history).toHaveLength(2);
  });

  it('flips the cheapest supplier once the quote rises past the rival', async () => {
    const res = await owner.request(`/products/${productId}/suppliers`);
    // 268.00 for 12 is 22.3333 each, now worse than the 22.00 single.
    expect(res.body[0].supplierName).toBe('Corner Single');
    expect(res.body[0].cheapest).toBe(true);
  });

  it('rejects a second link between the same supplier and product', async () => {
    const res = await owner.request('/supplier-products', {
      requestId: uuid(),
      supplierId: singleSupplier,
      productId,
      packSize: '1',
      packCost: '19.00',
    });
    // The upsert updates the existing row rather than creating a duplicate.
    expect(res.status).toBe(201);
    const offers = (await owner.request(`/products/${productId}/suppliers`)).body;
    expect(offers).toHaveLength(2);
    expect(offers[0].packCost).toBe('19.00');
  });

  it('refuses a zero pack size that would break the comparison', async () => {
    const res = await owner.request('/supplier-products', {
      requestId: uuid(),
      supplierId: singleSupplier,
      productId,
      packSize: '0',
      packCost: '19.00',
    });
    expect(res.status).toBe(400);
  });

  it('returns every offer ranked per product in one request', async () => {
    const res = await owner.request('/supplier-products');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // Ranking must survive the bulk grouping, not just the per-product endpoint.
    expect(res.body.filter((o: any) => o.cheapest)).toHaveLength(1);
    expect(res.body.every((o: any) => o.productId === productId)).toBe(true);
  });

  it('refuses callers without supplier permission', async () => {
    const anonymous = new Client();
    expect((await anonymous.request(`/products/${productId}/suppliers`)).status).toBe(401);
    expect((await anonymous.request('/supplier-products')).status).toBe(401);
  });
});
