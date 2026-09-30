import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
const admin = new Database();
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_purchase_test_${Date.now()}`;
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
describe.sequential('purchasing and receiving', () => {
  it('creates supplier and a draft without changing inventory', async () => {
    expect((await manager.request('/auth/setup', account)).status).toBe(201);
    const s = await manager.request('/suppliers', {
      requestId: requestId(),
      code: 'DAIRY',
      name: 'Dairy supplier',
    });
    expect(s.status).toBe(201);
    supplier = s.body;
    productId = (
      await manager.request('/products', {
        name: 'Milk',
        sku: 'MILK',
        category: 'Dairy',
        unit: 'piece',
        price: '15',
        cost: '5',
        minStock: '0',
        barcodes: [],
        plu: '',
      })
    ).body.id;
    const draft = await manager.request('/purchases', {
      requestId: requestId(),
      supplierId: supplier.id,
      lines: [{ productId, quantity: '24', unitCost: '8', taxRate: '15', sellingPrice: '19' }],
    });
    expect(draft.status).toBe(201);
    order = draft.body;
    expect(order.total).toBe('220.80');
    expect(order.status).toBe('draft');
    expect(order.lines[0].proposed_selling_price).toBe('19.00');
    expect(
      (await db.pool.query('SELECT price FROM products WHERE id=$1', [productId])).rows[0].price,
    ).toBe('15.00');
    expect(
      (await db.pool.query('SELECT stock FROM products WHERE id=$1', [productId])).rows[0].stock,
    ).toBe('0.000');
  });
  it('saves a dedicated supplier WhatsApp number and exposes it on purchase orders', async () => {
    const updated = await manager.request('/suppliers', {
      ...supplier,
      whatsappPhone: '+4791234567',
      requestId: requestId(),
    });
    expect(updated.status).toBe(201);
    expect(updated.body.whatsappPhone).toBe('+4791234567');
    supplier = updated.body;
    expect((await manager.request('/purchases/' + order.id)).body.supplierWhatsAppPhone).toBe(
      '+4791234567',
    );
    expect(
      (await manager.request('/suppliers')).body.find((s: any) => s.id === supplier.id)
        .whatsappPhone,
    ).toBe('+4791234567');
    expect(
      (
        await manager.request('/suppliers', {
          ...supplier,
          whatsappPhone: '91234567',
          requestId: requestId(),
        })
      ).status,
    ).toBe(400);
  });
  it('places once and rejects stale order changes', async () => {
    const body = { requestId: requestId(), version: order.version, status: 'ordered' };
    const response = await manager.request('/purchases/' + order.id + '/status', body);
    expect(response.status).toBe(201);
    expect((await manager.request('/purchases/' + order.id + '/status', body)).body).toEqual(
      response.body,
    );
    expect(
      (
        await manager.request('/purchases/' + order.id + '/status', {
          ...body,
          requestId: requestId(),
        })
      ).status,
    ).toBe(409);
    order = response.body;
  });
  it('rejects stale and missing selling-price confirmation without receiving stock', async () => {
    for (const expectedSellingPrice of [undefined, '14']) {
      const result = await manager.request('/purchases/' + order.id + '/receipts', {
        requestId: requestId(),
        version: order.version,
        lines: [
          {
            purchaseLineId: order.lines[0].id,
            quantity: '1',
            sellingPrice: '19',
            expectedSellingPrice,
          },
        ],
      });
      expect(result.status).toBe(409);
    }
    expect(
      (await db.pool.query('SELECT stock,price FROM products WHERE id=$1', [productId])).rows[0],
    ).toEqual({ stock: '0.000', price: '15.00' });
  });
  it('requires catalog permission to change a selling price while receiving', async () => {
    const role = (await db.pool.query("SELECT id,permissions FROM roles WHERE name='Owner'"))
      .rows[0];
    await db.pool.query('UPDATE roles SET permissions=$2 WHERE id=$1', [
      role.id,
      JSON.stringify(role.permissions.filter((p: string) => p !== 'catalog.write')),
    ]);
    try {
      const result = await manager.request('/purchases/' + order.id + '/receipts', {
        requestId: requestId(),
        version: order.version,
        lines: [
          {
            purchaseLineId: order.lines[0].id,
            quantity: '1',
            sellingPrice: '19',
            expectedSellingPrice: '15',
          },
        ],
      });
      expect(result.status).toBe(400);
      expect(
        (await db.pool.query('SELECT stock,price FROM products WHERE id=$1', [productId])).rows[0],
      ).toEqual({ stock: '0.000', price: '15.00' });
    } finally {
      await db.pool.query('UPDATE roles SET permissions=$2 WHERE id=$1', [
        role.id,
        JSON.stringify(role.permissions),
      ]);
    }
  });

  it('receives multiple expiry batches atomically without splitting financial rounding', async () => {
    const product = (
      await manager.request('/products', {
        name: 'Mixed expiry milk',
        sku: 'MIXED-EXPIRY',
        category: 'Dairy',
        unit: 'piece',
        price: '1',
        cost: '0.01',
        taxRate: '0',
        minStock: '0',
        barcodes: [],
        plu: '',
      })
    ).body;
    const draft = await manager.request('/purchases', {
      requestId: requestId(),
      supplierId: supplier.id,
      lines: [{ productId: product.id, quantity: '10', unitCost: '0.01', taxRate: '10' }],
    });
    expect(draft.status).toBe(201);
    const placed = (
      await manager.request('/purchases/' + draft.body.id + '/status', {
        requestId: requestId(),
        version: draft.body.version,
        status: 'ordered',
      })
    ).body;
    const receipt = {
      requestId: requestId(),
      version: placed.version,
      lines: [
        {
          purchaseLineId: placed.lines[0].id,
          quantity: '10',
          expiryBatches: [
            { quantity: '5', expiryDate: '2035-01-01' },
            { quantity: '5', expiryDate: '2036-01-01' },
          ],
        },
      ],
    };
    for (const batches of [
      [
        { quantity: '5', expiryDate: '2035-01-01' },
        { quantity: '4', expiryDate: '2036-01-01' },
      ],
      [
        { quantity: '4.5', expiryDate: '2035-01-01' },
        { quantity: '5.5', expiryDate: '2036-01-01' },
      ],
    ]) {
      expect(
        (
          await manager.request('/purchases/' + placed.id + '/receipts', {
            ...receipt,
            requestId: requestId(),
            lines: [{ ...receipt.lines[0], expiryBatches: batches }],
          })
        ).status,
      ).toBe(400);
      expect(
        (await db.pool.query('SELECT stock FROM products WHERE id=$1', [product.id])).rows[0].stock,
      ).toBe('0.000');
      expect(
        (
          await db.pool.query('SELECT count(*) FROM goods_receipts WHERE purchase_id=$1', [
            placed.id,
          ])
        ).rows[0].count,
      ).toBe('0');
    }
    const [first, retry] = await Promise.all([
      manager.request('/purchases/' + placed.id + '/receipts', receipt),
      manager.request('/purchases/' + placed.id + '/receipts', receipt),
    ]);
    expect(first.status).toBe(201);
    expect(retry.body).toEqual(first.body);
    expect(first.body.status).toBe('received');
    expect(first.body.receipts[0]).toMatchObject({ subtotal: '0.10', tax: '0.01', total: '0.11' });
    expect(first.body.receipts[0].lines).toHaveLength(1);
    expect(first.body.receipts[0].lines[0].expiry_batches).toEqual(receipt.lines[0].expiryBatches);
    const batches = (await manager.request('/inventory/products/' + product.id + '/batches')).body;
    expect(batches.product.stock).toBe('10.000');
    expect(batches.batches).toMatchObject([
      { quantity: '5.000', expiryDate: '2035-01-01' },
      { quantity: '5.000', expiryDate: '2036-01-01' },
    ]);
    expect(batches.batches).toHaveLength(2);
    const adjusted = await manager.request('/inventory/adjustments', {
      requestId: requestId(),
      productId: product.id,
      quantity: '-3',
      reason: 'count_correction',
      notes: 'Check batch depletion',
    });
    expect(adjusted.status).toBe(201);
    const remaining = (await manager.request('/inventory/products/' + product.id + '/batches'))
      .body;
    expect(remaining.batches).toMatchObject([
      { quantity: '2.000', expiryDate: '2035-01-01' },
      { quantity: '5.000', expiryDate: '2036-01-01' },
    ]);
    const history = (await manager.request('/purchases/' + placed.id)).body;
    expect(history.receipts[0].lines[0].expiry_batches).toEqual(receipt.lines[0].expiryBatches);
  });

  it('splits weighted deliveries into exact fractional batches with optional dates', async () => {
    const product = (
      await manager.request('/products', {
        name: 'Loose nuts',
        sku: 'SPLIT-WEIGHT',
        category: 'Food',
        unit: 'kilogram',
        price: '1',
        cost: '0.01',
        taxRate: '0',
        minStock: '0',
        barcodes: [],
        plu: '',
      })
    ).body;
    const draft = (
      await manager.request('/purchases', {
        requestId: requestId(),
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: '1', unitCost: '0.01', taxRate: '100' }],
      })
    ).body;
    const placed = (
      await manager.request('/purchases/' + draft.id + '/status', {
        requestId: requestId(),
        version: draft.version,
        status: 'ordered',
      })
    ).body;
    const response = await manager.request('/purchases/' + placed.id + '/receipts', {
      requestId: requestId(),
      version: placed.version,
      lines: [
        {
          purchaseLineId: placed.lines[0].id,
          quantity: '1',
          expiryBatches: [
            { quantity: '0.5', expiryDate: '2035-01-01' },
            { quantity: '0.5', expiryDate: null },
          ],
        },
      ],
    });
    expect(response.status).toBe(201);
    expect(response.body.receipts[0]).toMatchObject({
      subtotal: '0.01',
      tax: '0.01',
      total: '0.02',
    });
    const inventory = (await manager.request('/inventory/products/' + product.id + '/batches'))
      .body;
    expect(inventory.product.stock).toBe('1.000');
    expect(inventory.batches).toMatchObject([
      { quantity: '0.500', expiryDate: '2035-01-01' },
      { quantity: '0.500', expiryDate: null },
    ]);
  });
  it('receives a partial delivery exactly once and preserves cost snapshots', async () => {
    const body = {
      requestId: requestId(),
      version: order.version,
      deliveryReference: 'Delivery 1',
      lines: [
        {
          purchaseLineId: order.lines[0].id,
          quantity: '18',
          expiryDate: '2035-01-01',
          unitCost: '9',
          sellingPrice: '19',
          expectedSellingPrice: '15',
        },
      ],
    };
    const [a, b] = await Promise.all([
      manager.request('/purchases/' + order.id + '/receipts', body),
      manager.request('/purchases/' + order.id + '/receipts', body),
    ]);
    expect(a.status).toBe(201);
    expect(b.body).toEqual(a.body);
    order = a.body;
    expect(order.status).toBe('partially_received');
    expect(order.receipts).toHaveLength(1);
    expect(order.lines[0].unit_cost).toBe('8.00');
    expect(order.receipts[0].lines[0].unit_cost).toBe('9.00');
    const batches = await manager.request('/inventory/products/' + productId + '/batches');
    expect(batches.status).toBe(200);
    expect(batches.body.batches).toMatchObject([
      { quantity: '18.000', expiryDate: '2035-01-01', expired: false },
    ]);
    expect(
      (await db.pool.query('SELECT stock,cost,price FROM products WHERE id=$1', [productId]))
        .rows[0],
    ).toEqual({ stock: '18.000', cost: '9.00', price: '19.00' });
    expect(
      (
        await manager.request('/purchases/' + order.id + '/receipts', {
          ...body,
          lines: [{ ...body.lines[0], quantity: '1' }],
        })
      ).status,
    ).toBe(409);
  });
  it('rejects excess and fractional deliveries without changing stock or receipts', async () => {
    for (const quantity of ['7', '0.5'])
      expect(
        (
          await manager.request('/purchases/' + order.id + '/receipts', {
            requestId: requestId(),
            version: order.version,
            lines: [{ purchaseLineId: order.lines[0].id, quantity }],
          })
        ).status,
      ).toBe(400);
    expect(
      (await db.pool.query('SELECT stock FROM products WHERE id=$1', [productId])).rows[0].stock,
    ).toBe('18.000');
    expect(
      (await db.pool.query('SELECT count(*) FROM goods_receipts WHERE purchase_id=$1', [order.id]))
        .rows[0].count,
    ).toBe('1');
    expect(
      (
        await manager.request('/purchases/' + order.id + '/status', {
          requestId: requestId(),
          version: order.version,
          status: 'cancelled',
          reason: 'Changed mind',
        })
      ).status,
    ).toBe(409);
  });
  it('receives remaining stock despite supplier deactivation and keeps immutable history', async () => {
    expect(
      (await manager.request('/suppliers', { ...supplier, requestId: requestId(), active: false }))
        .status,
    ).toBe(201);
    const response = await manager.request('/purchases/' + order.id + '/receipts', {
      requestId: requestId(),
      version: order.version,
      lines: [{ purchaseLineId: order.lines[0].id, quantity: '6' }],
    });
    expect(response.status).toBe(201);
    order = response.body;
    expect(order.status).toBe('received');
    expect(order.receipts).toHaveLength(2);
    expect(
      (await db.pool.query('SELECT stock,cost,price FROM products WHERE id=$1', [productId]))
        .rows[0],
    ).toEqual({ stock: '24.000', cost: '8.00', price: '19.00' });
    await expect(db.pool.query("UPDATE goods_receipts SET notes='changed'")).rejects.toThrow();
    expect(
      (await db.pool.query('SELECT count(*) FROM movements WHERE purchase_id=$1', [order.id]))
        .rows[0].count,
    ).toBe('2');
  });
  it('denies unauthenticated access and rejects inactive suppliers on new drafts', async () => {
    expect((await new Client().request('/purchases')).status).toBe(401);
    expect(
      (
        await manager.request('/purchases', {
          requestId: requestId(),
          supplierId: supplier.id,
          lines: [{ productId, quantity: '1', unitCost: '8', taxRate: '15' }],
        })
      ).status,
    ).toBe(400);
  });

  it('hides purchasing from cashier roles and isolates another store', async () => {
    const roles = (await manager.request('/team/roles')).body;
    const roleId = roles.find((r: any) => r.name === 'Cashier').id;
    await manager.request('/team', {
      name: 'Cashier',
      employeeCode: 'BUYER',
      roleId,
      pin: '123456',
      email: 'cashier@purchases.test',
      password: 'cashier-password-12345',
    });
    const cashier = new Client();
    await cashier.request('/auth/login', {
      email: 'cashier@purchases.test',
      password: 'cashier-password-12345',
    });
    expect((await cashier.request('/purchases')).status).toBe(403);
    expect(
      (await cashier.request('/suppliers', { requestId: requestId(), name: 'No', code: 'NO' }))
        .status,
    ).toBe(403);
    const organization = (await db.pool.query('SELECT organization_id FROM stores LIMIT 1')).rows[0]
      .organization_id;
    const foreignStore = (
      await db.pool.query(
        "INSERT INTO stores(organization_id,name,currency,timezone) VALUES($1,'Other','NOK','Europe/Oslo') RETURNING id",
        [organization],
      )
    ).rows[0].id;
    const foreignSupplier = (
      await db.pool.query(
        "INSERT INTO suppliers(store_id,code,name) VALUES($1,'OTHER','Other') RETURNING id",
        [foreignStore],
      )
    ).rows[0].id;
    expect(
      (
        await manager.request('/purchases', {
          requestId: requestId(),
          supplierId: foreignSupplier,
          lines: [{ productId, quantity: '1', unitCost: '1', taxRate: '0' }],
        })
      ).status,
    ).toBe(400);
  });
  it('tracks overdue and paid independently of receiving, with safe retries and auditing', async () => {
    const current = (await manager.request('/purchases/' + order.id)).body;
    expect(current.status).toBe('received');
    expect(current.payment_status).toBe('unpaid');
    const stockBefore = (await manager.request('/products')).body;
    const body = {
      requestId: requestId(),
      version: current.version,
      status: 'unpaid',
      dueDate: '2000-01-01',
    };
    const overdue = await manager.request('/purchases/' + order.id + '/payment', body);
    expect(overdue.status).toBe(201);
    expect(overdue.body).toMatchObject({
      status: 'received',
      payment_status: 'unpaid',
      payment_overdue: true,
      payment_due_date: '2000-01-01',
      paid_at: null,
    });
    expect((await manager.request('/purchases/' + order.id + '/payment', body)).body).toEqual(
      overdue.body,
    );
    expect(
      (
        await manager.request('/purchases/' + order.id + '/payment', {
          ...body,
          requestId: requestId(),
          status: 'paid',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await manager.request('/purchases/' + order.id + '/payment', {
          ...body,
          requestId: requestId(),
          version: overdue.body.version,
          dueDate: '2026-02-30',
        })
      ).status,
    ).toBe(400);
    const paid = await manager.request('/purchases/' + order.id + '/payment', {
      ...body,
      requestId: requestId(),
      version: overdue.body.version,
      status: 'paid',
    });
    expect(paid.status).toBe(201);
    expect(paid.body).toMatchObject({
      status: 'received',
      payment_status: 'paid',
      payment_overdue: false,
    });
    expect(paid.body.paid_at).toBeTruthy();
    const listed = (await manager.request('/purchases')).body.find((p: any) => p.id === order.id);
    expect(listed.payment_status).toBe('paid');
    expect((await manager.request('/products')).body).toEqual(stockBefore);
    const audit = await db.pool.query(
      "SELECT * FROM audits WHERE entity_id=$1 AND action='Purchase payment updated'",
      [order.id],
    );
    expect(audit.rowCount).toBe(2);
    const clear = await manager.request('/purchases/' + order.id + '/payment', {
      requestId: requestId(),
      version: paid.body.version,
      status: 'unpaid',
      dueDate: '',
    });
    expect(clear.body).toMatchObject({
      payment_status: 'unpaid',
      payment_overdue: false,
      payment_due_date: null,
      paid_at: null,
    });
  });
  it('serializes concurrent payment updates and preserves the original paid date on retries', async () => {
    const before = (await manager.request('/purchases/' + order.id)).body;
    const payload = {
      requestId: requestId(),
      version: before.version,
      status: 'paid',
      dueDate: '',
    };
    const replies = await Promise.all([
      manager.request('/purchases/' + order.id + '/payment', payload),
      manager.request('/purchases/' + order.id + '/payment', payload),
    ]);
    expect(replies.map((r) => r.status)).toEqual([201, 201]);
    expect(replies[0].body).toEqual(replies[1].body);
    const paid = replies[0].body;
    expect(paid.version).toBe(before.version + 1);
    expect(
      (
        await manager.request('/purchases/' + order.id + '/payment', {
          ...payload,
          status: 'unpaid',
        })
      ).status,
    ).toBe(409);
    const again = await manager.request('/purchases/' + order.id + '/payment', {
      ...payload,
      requestId: requestId(),
      version: paid.version,
    });
    expect(again.status).toBe(201);
    expect(again.body.paid_at).toBe(paid.paid_at);
    const race = await Promise.all(
      ['unpaid', 'paid'].map((status) =>
        manager.request('/purchases/' + order.id + '/payment', {
          ...payload,
          requestId: requestId(),
          version: again.body.version,
          status,
        }),
      ),
    );
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    const current = (await manager.request('/purchases/' + order.id)).body;
    expect(current.version).toBe(again.body.version + 1);
    expect(
      (
        await manager.request('/purchases/' + order.id + '/payment', {
          ...payload,
          requestId: requestId(),
          version: current.version,
          status: 'unpaid',
        })
      ).status,
    ).toBe(201);
  });

  it('closes a partial remainder once, preserving stock, receipts and unpaid status', async () => {
    await db.pool.query('UPDATE suppliers SET active=true WHERE id=$1', [supplier.id]);
    let current = (
      await manager.request('/purchases', {
        requestId: requestId(),
        supplierId: supplier.id,
        lines: [{ productId, quantity: '10', unitCost: '5', taxRate: '0' }],
      })
    ).body;
    const close = (body: any) =>
      manager.request('/purchases/' + current.id + '/close-remainder', body);
    expect(
      (await close({ requestId: requestId(), version: current.version, reason: 'Unavailable' }))
        .status,
    ).toBe(409);
    current = (
      await manager.request('/purchases/' + current.id + '/status', {
        requestId: requestId(),
        version: current.version,
        status: 'ordered',
      })
    ).body;
    current = (
      await manager.request('/purchases/' + current.id + '/receipts', {
        requestId: requestId(),
        version: current.version,
        lines: [{ purchaseLineId: current.lines[0].id, quantity: '3' }],
      })
    ).body;
    expect(current.status).toBe('partially_received');
    current = (
      await manager.request('/purchases/' + current.id + '/payment', {
        requestId: requestId(),
        version: current.version,
        status: 'unpaid',
        dueDate: '2020-01-01',
      })
    ).body;
    expect(
      (await close({ requestId: requestId(), version: current.version, reason: ' ' })).status,
    ).toBe(400);
    expect(
      (await close({ requestId: requestId(), version: current.version - 1, reason: 'Unavailable' }))
        .status,
    ).toBe(409);
    const before = (await manager.request('/products')).body;
    const incomingBefore = (await manager.request('/shopping-lists/products')).body.find(
      (p: any) => p.productId === productId,
    ).incoming;
    const body = {
      requestId: requestId(),
      version: current.version,
      reason: 'Supplier discontinued the remaining goods',
    };
    const result = await close(body);
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      status: 'closed',
      close_reason: body.reason,
      payment_status: 'unpaid',
      payment_overdue: true,
      total: current.total,
    });
    expect(result.body.closed_at).toBeTruthy();
    expect(result.body.closed_by_name).toBe('Owner');
    expect(result.body.lines).toEqual(current.lines);
    expect(result.body.receipts).toEqual(current.receipts);
    expect((await close(body)).body).toEqual(result.body);
    expect(
      (await close({ ...body, requestId: requestId(), version: result.body.version })).status,
    ).toBe(409);
    expect(
      (
        await manager.request('/purchases/' + current.id + '/receipts', {
          requestId: requestId(),
          version: result.body.version,
          lines: [{ purchaseLineId: current.lines[0].id, quantity: '1' }],
        })
      ).status,
    ).toBe(409);
    expect((await manager.request('/products')).body).toEqual(before);
    const incomingAfter = (await manager.request('/shopping-lists/products')).body.find(
      (p: any) => p.productId === productId,
    ).incoming;
    expect(Number(incomingBefore) - Number(incomingAfter)).toBe(7);
    const history = await db.pool.query(
      "SELECT * FROM audits WHERE entity_id=$1 AND action='Purchase remainder closed'",
      [current.id],
    );
    expect(history.rowCount).toBe(1);
  });

  it('removes only unused suppliers and draft purchases', async () => {
    expect((await manager.request('/suppliers/' + supplier.id, undefined, 'DELETE')).status).toBe(
      409,
    );
    expect((await manager.request('/purchases/' + order.id, undefined, 'DELETE')).status).toBe(409);

    const unused = await manager.request('/suppliers', {
      requestId: requestId(),
      code: 'UNUSED',
      name: 'Unused supplier',
    });
    expect(unused.status).toBe(201);
    expect(
      (await manager.request('/suppliers/' + unused.body.id, undefined, 'DELETE')).status,
    ).toBe(200);
    expect(
      (await manager.request('/suppliers/' + unused.body.id, undefined, 'DELETE')).status,
    ).toBe(404);

    const fresh = await manager.request('/suppliers', {
      requestId: requestId(),
      code: 'DRAFTONLY',
      name: 'Draft supplier',
    });
    expect(fresh.status).toBe(201);
    const draft = await manager.request('/purchases', {
      requestId: requestId(),
      supplierId: fresh.body.id,
      lines: [{ productId, quantity: '2', unitCost: '8', taxRate: '15', sellingPrice: '19' }],
    });
    expect(draft.status).toBe(201);
    expect((await manager.request('/suppliers/' + fresh.body.id, undefined, 'DELETE')).status).toBe(
      409,
    );
    expect((await manager.request('/purchases/' + draft.body.id, undefined, 'DELETE')).status).toBe(
      200,
    );
    expect((await manager.request('/purchases/' + draft.body.id)).status).toBe(404);
    // Draft creation also records the supplier's product offer; deleting the draft
    // must not silently discard that reusable price relationship.
    expect((await manager.request('/suppliers/' + fresh.body.id, undefined, 'DELETE')).status).toBe(
      409,
    );
    const offers = (await manager.request('/suppliers/' + fresh.body.id + '/products')).body;
    expect(JSON.stringify(offers)).toContain(productId);
  });
  it('stores normalized supplier tags, validates limits, and preserves omitted tags on updates', async () => {
    const created = await manager.request('/suppliers', {
      requestId: requestId(),
      code: 'TAGGED',
      name: 'Tagged supplier',
      tags: [' Drinks ', 'drinks', 'Local'],
    });
    expect(created.status).toBe(201);
    expect(created.body.tags).toEqual(['Drinks', 'Local']);
    const { tags, ...withoutTags } = created.body;
    const updated = await manager.request('/suppliers', {
      ...withoutTags,
      name: 'Renamed supplier',
      requestId: requestId(),
    });
    expect(updated.status).toBe(201);
    expect(updated.body.tags).toEqual(['Drinks', 'Local']);
    const cleared = await manager.request('/suppliers', {
      ...updated.body,
      tags: [],
      requestId: requestId(),
    });
    expect(cleared.body.tags).toEqual([]);
    expect(
      (
        await manager.request('/suppliers', {
          requestId: requestId(),
          code: 'INVALID-TAGS',
          name: 'Invalid',
          tags: [''],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await manager.request('/suppliers', {
          requestId: requestId(),
          code: 'TOO-MANY-TAGS',
          name: 'Invalid',
          tags: Array.from({ length: 21 }, (_, i) => 'Tag ' + i),
        })
      ).status,
    ).toBe(400);
  });
});
