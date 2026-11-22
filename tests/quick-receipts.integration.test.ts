import { beforeAll, afterAll, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';

const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_quick_receipts_${Date.now()}`;
const admin = new Database();
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
        Cookie: [...this.cookies].map(([key, value]) => key + '=' + value).join('; '),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [key, value] = cookie.split(';')[0].split('=');
      if (value) this.cookies.set(key, value);
    }
    return { status: response.status, body: await response.json() };
  }
}
beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE ${name}`);
  const parsed = new URL(original);
  parsed.pathname = '/' + name;
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

const owner = new Client(),
  register = new Client(),
  other = new Client();
let storeId: string,
  productId: string,
  supplierId: string,
  shortcut: any,
  cashierId: string,
  cashierRole: string,
  receiverRole: string;
const account = {
  storeName: 'Quick deliveries',
  ownerName: 'Owner',
  email: 'quick@local.test',
  password: 'owner-password-12345',
  currency: 'NOK',
  timezone: 'Europe/Oslo',
};
const requestId = () => crypto.randomUUID();
const record = (overrides: any = {}) => ({
  requestId: requestId(),
  version: shortcut.version,
  quantity: '100',
  unitCost: '2.50',
  ...overrides,
});
beforeAll(async () => {
  expect((await owner.request('/auth/setup', account)).status).toBe(201);
  const session = (await owner.request('/auth/session')).body;
  storeId = session.store.id;
  supplierId = (
    await owner.request('/suppliers', {
      requestId: requestId(),
      code: 'BAKER',
      name: 'Morning bakery',
    })
  ).body.id;
  productId = (
    await owner.request('/products', {
      name: 'Bread',
      sku: 'BREAD',
      category: 'Bakery',
      unit: 'piece',
      price: '8',
      minStock: '0',
      barcodes: ['1234567890123'],
    })
  ).body.id;
  const saved = await owner.request('/quick-receipts', {
    requestId: requestId(),
    name: 'Fresh bread',
    supplierId,
    productId,
    taxRate: '15',
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(201);
  shortcut = (await owner.request('/quick-receipts')).body[0];
  const roles = (await owner.request('/team/roles')).body;
  cashierRole = roles.find((r: any) => r.name === 'Cashier').id;
  receiverRole = roles.find((r: any) => r.name === 'Receiving clerk').id;
  cashierId = (
    await owner.request('/team', {
      name: 'Receiver',
      employeeCode: 'RECEIVER',
      roleId: cashierRole,
      roleIds: [cashierRole, receiverRole],
      pin: '123456',
    })
  ).body.id;
  await register.request('/auth/login', { email: account.email, password: account.password });
  expect((await register.request('/pos/enroll', { name: 'Receiving register' })).status).toBe(201);
  expect(
    (await register.request('/pos/login', { employeeCode: 'RECEIVER', pin: '123456' })).status,
  ).toBe(200);
});
it('requires an explicit actual price and keeps all historical costs out of shortcut responses', async () => {
  expect(shortcut).toMatchObject({
    supplierName: 'Morning bakery',
    productName: 'Bread',
    available: true,
  });
  expect(shortcut).not.toHaveProperty('unitCost');
  expect(shortcut).not.toHaveProperty('cost');
  expect((await owner.request('/quick-receipts/options')).body.products[0].barcodes).toContain(
    '1234567890123',
  );
  const body = record();
  delete body.unitCost;
  expect((await owner.request('/quick-receipts/' + shortcut.id + '/receive', body)).status).toBe(
    400,
  );
  expect(
    (
      await owner.request(
        '/quick-receipts/' + shortcut.id + '/receive',
        record({ quantity: '1.5' }),
      )
    ).status,
  ).toBe(400);
  expect(
    (await owner.request('/quick-receipts/' + shortcut.id + '/receive', record({ unitCost: '' })))
      .status,
  ).toBe(400);
  expect(
    (
      await owner.request(
        '/quick-receipts/' + shortcut.id + '/receive',
        record({ unitCost: '2', sellingPrice: '10' }),
      )
    ).status,
  ).toBe(400);
  expect((await db.pool.query('SELECT count(*)::int AS n FROM purchases')).rows[0].n).toBe(0);
});
it('creates standard delivered purchases, distinct costed batches, movements and actor audit without changing selling price or cash', async () => {
  const request = record({ expiryDate: '2027-01-01', deliveryReference: 'Bread delivery 1' });
  const response = await owner.request('/quick-receipts/' + shortcut.id + '/receive', request);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  expect(response.body.total).toBe('287.50');
  const purchase = (await owner.request('/purchases/' + response.body.purchaseId)).body;
  expect(purchase).toMatchObject({ status: 'received', payment_status: 'unpaid', total: '287.50' });
  const again = await owner.request('/quick-receipts/' + shortcut.id + '/receive', request);
  expect(again.body).toEqual(response.body);
  expect(
    (
      await owner.request('/quick-receipts/' + shortcut.id + '/receive', {
        ...request,
        unitCost: '3',
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await owner.request(
        '/quick-receipts/' + shortcut.id + '/receive',
        record({ quantity: '50', unitCost: '3.00' }),
      )
    ).status,
  ).toBe(201);
  const product = (await db.pool.query('SELECT stock,price FROM products WHERE id=$1', [productId]))
    .rows[0];
  expect(product).toEqual({ stock: '150.000', price: '8.00' });
  const batches = (
    await db.pool.query(
      'SELECT quantity,unit_cost,cost_source,expiry_date::text FROM stock_batches WHERE product_id=$1 ORDER BY created_at,id',
      [productId],
    )
  ).rows;
  expect(batches).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        quantity: '100.000',
        unit_cost: '2.50',
        cost_source: 'receipt',
        expiry_date: '2027-01-01',
      }),
      expect.objectContaining({ quantity: '50.000', unit_cost: '3.00', cost_source: 'receipt' }),
    ]),
  );
  const movements = (
    await db.pool.query('SELECT reason,goods_receipt_id FROM movements WHERE product_id=$1', [
      productId,
    ])
  ).rows;
  expect(movements).toHaveLength(2);
  expect(movements.every((m) => m.reason === 'received' && m.goods_receipt_id)).toBe(true);
  expect((await db.pool.query('SELECT count(*)::int AS n FROM cash_movements')).rows[0].n).toBe(0);
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int AS n FROM supplier_products WHERE product_id=$1 AND supplier_id=$2',
        [productId, supplierId],
      )
    ).rows[0].n,
  ).toBe(1);
});
it('accepts deliveries from a narrow POS role while denying general purchases, configuration and financial history', async () => {
  const list = await register.request('/pos/quick-receipts');
  expect(list.status).toBe(200);
  expect(list.body).toHaveLength(1);
  expect(list.body[0]).not.toHaveProperty('cost');
  expect((await register.request('/purchases')).status).toBe(401);
  expect((await register.request('/quick-receipts/options')).status).toBe(401);
  const b = record({ quantity: '10', unitCost: '4' });
  const [one, two] = await Promise.all([
    register.request('/pos/quick-receipts/' + shortcut.id + '/receive', b),
    register.request('/pos/quick-receipts/' + shortcut.id + '/receive', b),
  ]);
  expect(one.status, JSON.stringify(one.body)).toBe(201);
  expect(two.body).toEqual(one.body);
  const receipt = (
    await db.pool.query('SELECT employee_id FROM goods_receipts WHERE id=$1', [one.body.receiptId])
  ).rows[0];
  expect(receipt.employee_id).toBe(cashierId);
  expect(
    (await db.pool.query('SELECT stock FROM products WHERE id=$1', [productId])).rows[0].stock,
  ).toBe('160.000');
});
it('rejects revoked access immediately and keeps anonymous/locked registers out', async () => {
  await db.pool.query('DELETE FROM employee_roles WHERE employee_id=$1 AND role_id=$2', [
    cashierId,
    receiverRole,
  ]);
  expect((await register.request('/pos/quick-receipts')).status).toBe(403);
  expect(
    (await register.request('/pos/quick-receipts/' + shortcut.id + '/receive', record())).status,
  ).toBe(403);
  await db.pool.query('INSERT INTO employee_roles(employee_id,role_id,store_id) VALUES($1,$2,$3)', [
    cashierId,
    receiverRole,
    storeId,
  ]);
  const anonymous = new Client();
  expect((await anonymous.request('/pos/quick-receipts')).status).toBe(401);
  await register.request('/pos/lock', {});
  expect((await register.request('/pos/quick-receipts')).status).toBe(401);
});
it('rejects cross-store shortcuts/products/suppliers without creating purchases', async () => {
  process.env.ALLOW_REGISTRATION = 'true';
  try {
    expect(
      (
        await other.request('/auth/register', {
          ...account,
          email: 'other-quick@local.test',
          storeName: 'Other store',
        })
      ).status,
    ).toBe(201);
  } finally {
    delete process.env.ALLOW_REGISTRATION;
  }
  expect((await other.request('/quick-receipts')).body).toEqual([]);
  expect(
    (await other.request('/quick-receipts/' + shortcut.id + '/receive', record())).status,
  ).toBe(404);
  expect(
    (
      await other.request('/quick-receipts', {
        requestId: requestId(),
        name: 'Foreign',
        supplierId,
        productId,
        taxRate: '0',
      })
    ).status,
  ).toBe(400);
});
it('rejects stale, archived and inactive shortcuts atomically, but allows safe replay after archiving', async () => {
  const b = record({ quantity: '1', unitCost: '0' });
  const accepted = await owner.request('/quick-receipts/' + shortcut.id + '/receive', b);
  expect(accepted.status).toBe(201);
  expect(
    (
      await owner.request('/quick-receipts', {
        requestId: requestId(),
        id: shortcut.id,
        version: shortcut.version,
        name: shortcut.name,
        supplierId,
        productId,
        taxRate: '0',
        active: false,
      })
    ).status,
  ).toBe(201);
  expect(
    (await owner.request('/quick-receipts/' + shortcut.id + '/receive', record())).status,
  ).toBe(409);
  expect((await owner.request('/quick-receipts/' + shortcut.id + '/receive', b)).body).toEqual(
    accepted.body,
  );
  shortcut = (await owner.request('/quick-receipts')).body[0];
  expect(
    (
      await owner.request('/quick-receipts', {
        requestId: requestId(),
        id: shortcut.id,
        version: shortcut.version,
        name: shortcut.name,
        supplierId,
        productId,
        taxRate: '0',
        active: true,
      })
    ).status,
  ).toBe(201);
  shortcut = (await owner.request('/quick-receipts')).body[0];
  await db.pool.query('UPDATE products SET active=false WHERE id=$1', [productId]);
  const before = (await db.pool.query('SELECT count(*)::int AS n FROM purchases')).rows[0].n;
  expect(
    (await owner.request('/quick-receipts/' + shortcut.id + '/receive', record())).status,
  ).toBe(400);
  expect((await db.pool.query('SELECT count(*)::int AS n FROM purchases')).rows[0].n).toBe(before);
});
