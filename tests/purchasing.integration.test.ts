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
  it('receives a partial delivery exactly once and preserves cost snapshots', async () => {
    const body = {
      requestId: requestId(),
      version: order.version,
      deliveryReference: 'Delivery 1',
      lines: [
        {
          purchaseLineId: order.lines[0].id,
          quantity: '18',
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
    expect((await db.pool.query('SELECT count(*) FROM goods_receipts')).rows[0].count).toBe('1');
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
    expect((await manager.request('/suppliers/' + fresh.body.id, undefined, 'DELETE')).status).toBe(
      200,
    );
  });
});
