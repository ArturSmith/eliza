import sharp from 'sharp';
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
let productId: string,
  caseSupplier: string,
  singleSupplier: string,
  offerId: string,
  productImage: string;

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
    productImage =
      'data:image/jpeg;base64,' +
      (
        await sharp({ create: { width: 8, height: 8, channels: 3, background: '#d7e6d4' } })
          .jpeg()
          .toBuffer()
      ).toString('base64');
    productId = (
      await owner.request('/products', {
        name: 'Nutella',
        image: productImage,
        description: 'Hazelnut spread',
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

  it('keeps the same offer fields across both catalogue endpoints', async () => {
    const [fromSupplier] = (await owner.request(`/suppliers/${caseSupplier}/products`)).body;
    const fromProduct = (await owner.request(`/products/${productId}/suppliers`)).body.find(
      (o: any) => o.supplierId === caseSupplier,
    );
    // Shared offer facts must remain complete; only the supplier grid needs photo metadata.
    const cardFields = ['productImage', 'productDescription', 'productCategory', 'productActive'];
    expect(
      Object.keys(fromSupplier)
        .filter((key) => !cardFields.includes(key))
        .sort(),
    ).toEqual(Object.keys(fromProduct).sort());
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

  it('links purchase products automatically without overwriting a manual supplier offer', async () => {
    const freshProductId = (
      await owner.request('/products', {
        name: 'Tea',
        sku: 'TEA',
        category: 'Grocery',
        unit: 'piece',
        price: '9.00',
        cost: '4.00',
        taxRate: '0',
        minStock: '1',
        plu: '302',
        barcodes: [],
      })
    ).body.id;
    const draft = await owner.request('/purchases', {
      requestId: uuid(),
      supplierId: caseSupplier,
      supplierReference: 'TEST-AUTO-LINK',
      lines: [
        { productId: freshProductId, quantity: '2', unitCost: '4.50', taxRate: '0' },
        { productId, quantity: '1', unitCost: '99.00', taxRate: '0' },
      ],
    });
    expect(draft.status).toBe(201);
    const offers = (await owner.request(`/suppliers/${caseSupplier}/products`)).body;
    const added = offers.find((offer: any) => offer.productId === freshProductId);
    expect(added).toMatchObject({ packSize: '1.000', packCost: '4.50' });
    const manual = offers.find((offer: any) => offer.productId === productId);
    expect(manual).toMatchObject({
      supplierSku: 'W-NUT-12',
      packSize: '12.000',
      packCost: '268.00',
    });
    const history = (await owner.request(`/supplier-products/${added.id}/history`)).body;
    expect(history).toHaveLength(1);
    expect(history[0].packCost).toBe('4.50');
  });

  it('paginates exact supplier history and keeps search, status and payment filters scoped', async () => {
    const other = await owner.request('/purchases', {
      requestId: uuid(),
      supplierId: singleSupplier,
      lines: [{ productId, quantity: '1', unitCost: '4.50', taxRate: '0' }],
    });
    expect(other.status).toBe(201);
    for (let i = 0; i < 51; i++) {
      const draft = await owner.request('/purchases', {
        requestId: uuid(),
        supplierId: caseSupplier,
        supplierReference: 'PAGED-SUPPLIER-' + i,
        lines: [{ productId, quantity: '1', unitCost: '4.50', taxRate: '0' }],
      });
      expect(draft.status).toBe(201);
    }
    const first = await owner.request(`/purchases?page=1&supplierId=${caseSupplier}`);
    const second = await owner.request(`/purchases?page=2&supplierId=${caseSupplier}`);
    expect(first.status).toBe(200);
    expect(first.body.total).toBe(52);
    expect(first.body.rows).toHaveLength(50);
    expect(second.body.rows).toHaveLength(2);
    expect(
      [...first.body.rows, ...second.body.rows].every(
        (row: any) => row.supplier_id === caseSupplier,
      ),
    ).toBe(true);
    expect(new Set([...first.body.rows, ...second.body.rows].map((row: any) => row.id)).size).toBe(
      52,
    );
    const searched = await owner.request(
      `/purchases?page=1&supplierId=${caseSupplier}&search=PAGED-SUPPLIER-50&status=draft&payment=unpaid`,
    );
    expect(searched.body.total).toBe(1);
    expect(searched.body.rows[0].supplier_reference).toBe('PAGED-SUPPLIER-50');
    expect(
      (await owner.request(`/purchases?page=1&supplierId=${caseSupplier}&status=received`)).body
        .total,
    ).toBe(0);
    expect((await owner.request(`/purchases?page=1&supplierId=${singleSupplier}`)).body.total).toBe(
      1,
    );
    expect((await owner.request('/purchases?page=1&supplierId=' + uuid())).body.total).toBe(0);
    expect((await owner.request('/purchases?page=1&supplierId=invalid')).status).toBe(400);
    expect(
      (await new Client().request(`/purchases?page=1&supplierId=${caseSupplier}`)).status,
    ).toBe(401);
  });

  it('includes only public product details in the supplier catalog and keeps bulk quotes lightweight', async () => {
    const catalog = await owner.request(`/suppliers/${caseSupplier}/products`);
    expect(catalog.status).toBe(200);
    const item = catalog.body.find((offer: any) => offer.productId === productId);
    expect(item).toMatchObject({
      productImage,
      productDescription: 'Hazelnut spread',
      productCategory: 'Grocery',
      productActive: true,
    });
    expect(item).not.toHaveProperty('cost');
    expect(item).not.toHaveProperty('price');
    const bulk = await owner.request('/supplier-products');
    expect(bulk.body.every((offer: any) => !('productImage' in offer))).toBe(true);
    const forProduct = await owner.request(`/products/${productId}/suppliers`);
    expect(forProduct.body.every((offer: any) => !('productImage' in offer))).toBe(true);
  });

  it('refuses callers without supplier permission', async () => {
    const anonymous = new Client();
    expect((await anonymous.request(`/products/${productId}/suppliers`)).status).toBe(401);
    expect((await anonymous.request('/supplier-products')).status).toBe(401);
  });
  it('links existing products without inventing a supplier quote or changing stock', async () => {
    const supplier = (
      await owner.request('/suppliers', {
        requestId: uuid(),
        code: 'UNQUOTED',
        name: 'New supplier',
      })
    ).body;
    const before = (await owner.request('/products')).body.find((p: any) => p.id === productId);
    const command = { requestId: uuid(), productId };
    const linked = await owner.request(`/suppliers/${supplier.id}/products`, command);
    expect(linked.status).toBe(201);
    expect((await owner.request(`/suppliers/${supplier.id}/products`, command)).body).toEqual(
      linked.body,
    );
    expect(
      (await owner.request(`/suppliers/${supplier.id}/products`, { requestId: uuid(), productId }))
        .body,
    ).toEqual(linked.body);
    const offers = (await owner.request(`/suppliers/${supplier.id}/products`)).body;
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      packCost: null,
      unitCost: null,
      packSize: '1.000',
      version: 1,
    });
    expect((await owner.request(`/supplier-products/${linked.body.id}/history`)).body).toEqual([]);
    const after = (await owner.request('/products')).body.find((p: any) => p.id === productId);
    expect(after).toEqual(before);
    const ranked = (await owner.request(`/products/${productId}/suppliers`)).body;
    expect(ranked[ranked.length - 1]).toMatchObject({
      supplierId: supplier.id,
      cheapest: false,
      unitCost: null,
    });
    // An unknown supplier quote must not interfere with the existing costed receipt flow.
    let order = (
      await owner.request('/purchases', {
        requestId: uuid(),
        supplierId: supplier.id,
        lines: [{ productId, quantity: '1', unitCost: '12.30', taxRate: '0' }],
      })
    ).body;
    order = (
      await owner.request(`/purchases/${order.id}/status`, {
        requestId: uuid(),
        version: order.version,
        status: 'ordered',
      })
    ).body;
    const received = await owner.request(`/purchases/${order.id}/receipts`, {
      requestId: uuid(),
      version: order.version,
      lines: [{ purchaseLineId: order.lines[0].id, quantity: '1' }],
    });
    expect(received.status).toBe(201);
    const current = (await owner.request(`/suppliers/${supplier.id}/products`)).body[0];
    expect(current).toMatchObject({ packCost: null, unitCost: null, lastPaidCost: '12.30' });
    expect(
      (
        await db.pool.query('SELECT unit_cost::text FROM stock_batches WHERE receipt_line_id=$1', [
          received.body.receipts[0].lines[0].id,
        ])
      ).rows[0].unit_cost,
    ).toBe('12.30');
  });

  it('does not overwrite an existing quotation when adding its product again', async () => {
    const before = (await owner.request(`/suppliers/${singleSupplier}/products`)).body.find(
      (o: any) => o.productId === productId,
    );
    expect(
      (
        await owner.request(`/suppliers/${singleSupplier}/products`, {
          requestId: uuid(),
          productId,
        })
      ).status,
    ).toBe(201);
    const after = (await owner.request(`/suppliers/${singleSupplier}/products`)).body.find(
      (o: any) => o.productId === productId,
    );
    expect(after).toEqual(before);
    const history = (await owner.request(`/supplier-products/${before.id}/history`)).body;
    expect(history.every((h: any) => h.packCost !== null)).toBe(true);
  });

  it('creates the product and its supplier relationship together without mandatory prices', async () => {
    const created = await owner.request('/products', {
      name: 'New local yogurt',
      sku: 'LOCAL-YOG',
      category: 'Dairy',
      unit: 'piece',
      minStock: '0',
      barcodes: ['5901234123457'],
      supplierId: caseSupplier,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      cost: null,
      price: null,
      stock: '0.000',
      barcodes: ['5901234123457'],
    });
    const catalog = (await owner.request(`/suppliers/${caseSupplier}/products`)).body;
    expect(catalog.filter((o: any) => o.productId === created.body.id)).toHaveLength(1);
    expect(catalog.find((o: any) => o.productId === created.body.id)).toMatchObject({
      packCost: null,
      unitCost: null,
    });
    const failed = await owner.request('/products', {
      name: 'Cannot be saved',
      sku: 'NO-SUPPLIER',
      category: 'Dairy',
      unit: 'piece',
      minStock: '0',
      barcodes: [],
      supplierId: uuid(),
    });
    expect(failed.status).toBe(400);
    expect((await db.pool.query("SELECT id FROM products WHERE sku='NO-SUPPLIER'")).rowCount).toBe(
      0,
    );
    expect(
      (
        await owner.request(`/suppliers/${caseSupplier}/products`, {
          requestId: uuid(),
          productId: uuid(),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await new Client().request(`/suppliers/${caseSupplier}/products`, {
          requestId: uuid(),
          productId,
        })
      ).status,
    ).toBe(401);
  });
  it('enforces supplier permissions and store isolation for product links and creation', async () => {
    const session = (await owner.request('/auth/session')).body;
    const role = (
      await db.pool.query(
        "INSERT INTO roles(store_id,name,permissions) VALUES($1,'Catalog editor',$2::jsonb) RETURNING id",
        [session.store.id, JSON.stringify(['catalog.read', 'catalog.write'])],
      )
    ).rows[0];
    const account = { email: 'editor@pos.test', password: 'editor-password-12345' };
    expect(
      (
        await owner.request('/team', {
          ...account,
          name: 'Editor',
          employeeCode: 'EDITOR',
          roleId: role.id,
          pin: '123456',
        })
      ).status,
    ).toBe(201);
    const editor = new Client();
    expect((await editor.request('/auth/login', account)).status).toBe(200);
    const draft = {
      name: 'Blocked product',
      sku: 'BLOCKED',
      category: 'Dairy',
      unit: 'piece',
      minStock: '0',
      barcodes: [],
    };
    expect((await editor.request('/products', { ...draft, supplierId: caseSupplier })).status).toBe(
      403,
    );
    expect(
      (
        await editor.request(`/suppliers/${caseSupplier}/products`, {
          requestId: uuid(),
          productId,
        })
      ).status,
    ).toBe(403);
    expect((await db.pool.query("SELECT id FROM products WHERE sku='BLOCKED'")).rowCount).toBe(0);
    const organization = (
      await db.pool.query('SELECT organization_id FROM stores WHERE id=$1', [session.store.id])
    ).rows[0].organization_id;
    const foreignStore = (
      await db.pool.query(
        "INSERT INTO stores(organization_id,name,currency,timezone) VALUES($1,'Other shop','NOK','Europe/Oslo') RETURNING id",
        [organization],
      )
    ).rows[0].id;
    const foreignSupplier = (
      await db.pool.query(
        "INSERT INTO suppliers(store_id,code,name) VALUES($1,'OTHER','Other supplier') RETURNING id",
        [foreignStore],
      )
    ).rows[0].id;
    expect(
      (await owner.request('/products', { ...draft, supplierId: foreignSupplier })).status,
    ).toBe(400);
    expect(
      (
        await owner.request(`/suppliers/${foreignSupplier}/products`, {
          requestId: uuid(),
          productId,
        })
      ).status,
    ).toBe(400);
    expect((await db.pool.query("SELECT id FROM products WHERE sku='BLOCKED'")).rowCount).toBe(0);
    await db.pool.query('UPDATE suppliers SET active=false WHERE id=$1', [foreignSupplier]);
    expect(
      (await owner.request('/products', { ...draft, supplierId: foreignSupplier })).status,
    ).toBe(400);
  });
});
