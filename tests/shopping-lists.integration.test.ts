import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
const admin = new Database();
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_shopping_test_${Date.now()}`;
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
const requestId = () => crypto.randomUUID();
let products: any[], suppliers: any[], list: any;
const editLines = (value: any) =>
  value.lines
    .filter((l: any) => !l.purchaseId)
    .map((l: any) => ({
      productId: l.productId,
      target: l.target,
      quantity: l.quantity,
      unitCost: l.unitCost,
      taxRate: l.taxRate,
      supplierId: l.supplierId,
      notes: l.notes,
    }));
async function save(value: any, lines: any[]) {
  return manager.request('/shopping-lists/' + value.id, {
    requestId: requestId(),
    version: value.version,
    name: value.name,
    notes: 'Weekly delivery',
    lines,
  });
}
describe.sequential('shopping-list planning and conversion', () => {
  it('generates low stock with remaining incoming quantities and unplaced drafts', async () => {
    expect(
      (
        await manager.request('/auth/setup', {
          storeName: 'Shopping',
          ownerName: 'Owner',
          email: 'owner@shopping.test',
          password: 'owner-password-12345',
          currency: 'NOK',
          timezone: 'Europe/Oslo',
        })
      ).status,
    ).toBe(201);
    suppliers = [];
    for (const code of ['A', 'B'])
      suppliers.push(
        (
          await manager.request('/suppliers', {
            requestId: requestId(),
            code,
            name: 'Supplier ' + code,
          })
        ).body,
      );
    products = [];
    for (const [sku, minStock] of [
      ['A', '10'],
      ['B', '2'],
      ['C', '2'],
    ]) {
      const p = (
        await manager.request('/products', {
          name: 'Product ' + sku,
          sku,
          category: 'Food',
          unit: 'piece',
          price: '10',
          cost: '5',
          taxRate: '0',
          minStock,
          barcodes: [],
        })
      ).body;
      products.push(p);
    }
    for (const [index, quantity] of [
      [0, '2'],
      [2, '10'],
    ] as const)
      expect(
        (
          await manager.request('/inventory/adjustments', {
            requestId: requestId(),
            productId: products[index].id,
            quantity,
            reason: 'opening_balance',
          })
        ).status,
      ).toBe(201);
    async function draft(quantity: string) {
      return (
        await manager.request('/purchases', {
          requestId: requestId(),
          supplierId: suppliers[0].id,
          lines: [{ productId: products[0].id, quantity, unitCost: '5', taxRate: '0' }],
        })
      ).body;
    }
    let order = await draft('5');
    order = (
      await manager.request('/purchases/' + order.id + '/status', {
        requestId: requestId(),
        version: order.version,
        status: 'ordered',
      })
    ).body;
    expect(
      (
        await manager.request('/purchases/' + order.id + '/receipts', {
          requestId: requestId(),
          version: order.version,
          lines: [{ purchaseLineId: order.lines[0].id, quantity: '2', unitCost: '5' }],
        })
      ).status,
    ).toBe(201);
    await draft('4');
    const cancelled = await draft('100');
    expect(
      (
        await manager.request('/purchases/' + cancelled.id + '/status', {
          requestId: requestId(),
          version: cancelled.version,
          status: 'cancelled',
          reason: 'Test',
        })
      ).status,
    ).toBe(201);
    const body = { requestId: requestId(), name: 'Weekly list' };
    const result = await manager.request('/shopping-lists', body);
    expect(result.status).toBe(201);
    list = result.body;
    expect(list.lines).toHaveLength(2);
    expect(list.lines.find((l: any) => l.productId === products[0].id)).toMatchObject({
      target: '20.000',
      stock: '4.000',
      incoming: '3.000',
      drafts: '4.000',
      quantity: '9.000',
    });
    expect((await manager.request('/shopping-lists', body)).body).toEqual(list);
    expect((await manager.request('/shopping-lists')).body[0]).toMatchObject({
      productCount: 2,
      convertedCount: 0,
    });
  });
  it('saves targets, suppliers, notes, manual additions and removals with version checks', async () => {
    let lines = editLines(list).map((l: any) => ({
      ...l,
      supplierId: l.productId === products[0].id ? suppliers[0].id : suppliers[1].id,
      target: l.productId === products[0].id ? '25' : '6',
      quantity: l.productId === products[0].id ? '14' : '3',
      notes: 'Review packaging',
    }));
    expect(
      (
        await save(
          list,
          lines.map((l: any) => ({ ...l, quantity: '0.5' })),
        )
      ).status,
    ).toBe(400);
    const old = list;
    lines.push({
      productId: products[2].id,
      target: '15',
      quantity: '5',
      unitCost: '5',
      taxRate: '0',
      supplierId: suppliers[0].id,
      notes: '',
    });
    let response = await save(list, lines);
    expect(response.status).toBe(201);
    list = response.body;
    expect(list.lines).toHaveLength(3);
    expect((await save(old, lines)).status).toBe(409);
    response = await save(
      list,
      editLines(list).filter((l: any) => l.productId !== products[2].id),
    );
    expect(response.status).toBe(201);
    list = response.body;
    expect(list.lines).toHaveLength(2);
    expect(list.notes).toBe('Weekly delivery');
    expect(list.lines[0].notes).toBe('Review packaging');
  });
  it('converts selected supplier groups atomically without changing stock or duplicating drafts', async () => {
    const before = (await manager.request('/products')).body;
    const countBefore = Number(
      (await db.pool.query('SELECT count(*) FROM purchases')).rows[0].count,
    );
    await db.pool.query('UPDATE suppliers SET active=false WHERE id=$1', [suppliers[1].id]);
    expect(
      (
        await manager.request('/shopping-lists/' + list.id + '/convert', {
          requestId: requestId(),
          version: list.version,
          lineIds: list.lines.map((l: any) => l.id),
        })
      ).status,
    ).toBe(400);
    expect(Number((await db.pool.query('SELECT count(*) FROM purchases')).rows[0].count)).toBe(
      countBefore,
    );
    await db.pool.query('UPDATE suppliers SET active=true WHERE id=$1', [suppliers[1].id]);
    const body = {
      requestId: requestId(),
      version: list.version,
      lineIds: list.lines.map((l: any) => l.id),
    };
    const result = await manager.request('/shopping-lists/' + list.id + '/convert', body);
    expect(result.status).toBe(201);
    list = result.body;
    expect(new Set(list.lines.map((l: any) => l.purchaseId)).size).toBe(2);
    expect(list.lines.every((l: any) => l.purchaseStatus === 'draft')).toBe(true);
    expect((await manager.request('/shopping-lists/' + list.id + '/convert', body)).body).toEqual(
      list,
    );
    expect(
      (
        await manager.request('/shopping-lists/' + list.id + '/convert', {
          ...body,
          requestId: requestId(),
          version: list.version,
        })
      ).status,
    ).toBe(409);
    expect(Number((await db.pool.query('SELECT count(*) FROM purchases')).rows[0].count)).toBe(
      countBefore + 2,
    );
    expect((await manager.request('/products')).body).toEqual(before);
    const next = (
      await manager.request('/shopping-lists', { requestId: requestId(), name: 'Next list' })
    ).body;
    expect(next.lines.find((l: any) => l.productId === products[0].id)).toMatchObject({
      target: '25.000',
      supplierId: suppliers[0].id,
      drafts: '18.000',
      quantity: '0.000',
    });
  });
  it('rejects cross-store references and users without purchase permissions', async () => {
    const other = new Client();
    const roles = (await manager.request('/team/roles')).body;
    await manager.request('/team', {
      name: 'Reader',
      employeeCode: 'READER',
      roleId: roles.find((r: any) => r.name === 'Cashier').id,
      email: 'reader@shopping.test',
      password: 'reader-password-12345',
      pin: '123456',
    });
    await other.request('/auth/login', {
      email: 'reader@shopping.test',
      password: 'reader-password-12345',
    });
    expect((await other.request('/shopping-lists')).status).toBe(403);
    expect(
      (await other.request('/shopping-lists', { requestId: requestId(), name: 'No' })).status,
    ).toBe(403);
    const organization = (await db.pool.query('SELECT organization_id FROM stores LIMIT 1')).rows[0]
      .organization_id;
    const foreignStore = (
      await db.pool.query(
        "INSERT INTO stores(organization_id,name,currency,timezone) VALUES($1,'Other','NOK','UTC') RETURNING id",
        [organization],
      )
    ).rows[0].id;
    const foreign = (
      await db.pool.query(
        "INSERT INTO shopping_lists(store_id,name) VALUES($1,'Private') RETURNING id",
        [foreignStore],
      )
    ).rows[0].id;
    expect((await manager.request('/shopping-lists/' + foreign)).status).toBe(404);
    expect(
      (
        await manager.request('/shopping-lists/' + foreign, {
          requestId: requestId(),
          version: 1,
          name: 'No',
          lines: [],
        })
      ).status,
    ).toBe(404);
  });
});
