import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
const admin = new Database();
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_count_test_${Date.now()}`;
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
let productId: string, otherId: string, count: any;
const requestId = () => crypto.randomUUID();
const account = {
  storeName: 'Count test',
  ownerName: 'Owner',
  email: 'owner@count.test',
  password: 'owner-password-12345',
  currency: 'NOK',
  timezone: 'Europe/Oslo',
};
async function command(action: string) {
  return manager.request('/stock-counts/' + count.id + '/action', {
    requestId: requestId(),
    version: count.version,
    action,
  });
}
async function save(lines: any[]) {
  return manager.request('/stock-counts/' + count.id + '/quantities', {
    requestId: requestId(),
    version: count.version,
    lines,
  });
}
async function adjust(quantity: string) {
  return manager.request('/inventory/adjustments', {
    requestId: requestId(),
    productId,
    quantity,
    reason: 'count_correction',
    notes: 'During count',
  });
}
describe.sequential('physical stock counts', () => {
  it('creates a draft without changing stock and snapshots selected products on start', async () => {
    expect((await manager.request('/auth/setup', account)).status).toBe(201);
    for (const [sku, stock] of [
      ['A', '50'],
      ['B', '4'],
    ]) {
      const p = await manager.request('/products', {
        name: sku,
        sku,
        category: 'Test',
        unit: 'piece',
        price: '1',
        cost: '0.5',
        minStock: '0',
        barcodes: [],
        plu: '',
      });
      expect(p.status).toBe(201);
      if (sku === 'A') productId = p.body.id;
      else otherId = p.body.id;
      expect(
        (
          await manager.request('/inventory/adjustments', {
            requestId: requestId(),
            productId: p.body.id,
            quantity: stock,
            reason: 'opening_balance',
          })
        ).status,
      ).toBe(201);
    }
    const body = { requestId: requestId(), name: 'Shelf count', productIds: [productId, otherId] };
    const r = await manager.request('/stock-counts', body);
    expect(r.status).toBe(201);
    count = r.body;
    expect(count.status).toBe('draft');
    expect(count.lines[0].system_quantity).toBeNull();
    expect((await manager.request('/stock-counts', body)).body).toEqual(count);
    const start = await command('start');
    expect(start.status).toBe(201);
    count = start.body;
    expect(count.lines.find((l: any) => l.product_id === productId).system_quantity).toBe('50.000');
  });
  it('requires saved quantities for every line and rejects fractional piece counts', async () => {
    expect((await save([{ productId, quantity: '47.5' }])).status).toBe(400);
    count = (await save([{ productId, quantity: '47' }])).body;
    expect((await command('review')).status).toBe(400);
    count = (await save([{ productId: otherId, quantity: '4' }])).body;
    expect(
      (
        await manager.request('/stock-counts/' + count.id + '/finalize', {
          requestId: requestId(),
          version: count.version,
        })
      ).status,
    ).toBe(409);
    count = (await command('review')).body;
  });
  it('finalizes once with exactly one correction and preserves immutable results', async () => {
    const b = { requestId: requestId(), version: count.version };
    const results = await Promise.all([
      manager.request('/stock-counts/' + count.id + '/finalize', b),
      manager.request('/stock-counts/' + count.id + '/finalize', b),
    ]);
    expect(results[0].status).toBe(201);
    expect(results[1].body).toEqual(results[0].body);
    count = results[0].body;
    expect(count.status).toBe('finalized');
    expect(
      (await db.pool.query('SELECT stock FROM products WHERE id=$1', [productId])).rows[0].stock,
    ).toBe('47.000');
    const moves = (
      await db.pool.query('SELECT quantity,balance FROM movements WHERE stock_count_id=$1', [
        count.id,
      ])
    ).rows;
    expect(moves).toEqual([{ quantity: '-3.000', balance: '47.000' }]);
    await expect(
      db.pool.query("UPDATE stock_counts SET notes='changed' WHERE id=$1", [count.id]),
    ).rejects.toThrow('immutable');
    await expect(
      db.pool.query('UPDATE stock_count_lines SET counted_quantity=0 WHERE count_id=$1', [
        count.id,
      ]),
    ).rejects.toThrow('immutable');
    expect((await save([{ productId, quantity: '1' }])).status).toBe(409);
  });
  it('rejects changed stock even when net movement is zero, then allows an explicit recount', async () => {
    count = (
      await manager.request('/stock-counts', {
        requestId: requestId(),
        name: 'Second count',
        productIds: [productId, otherId],
      })
    ).body;
    expect(
      (
        await manager.request('/stock-counts', {
          requestId: requestId(),
          name: 'Overlap',
          productIds: [productId],
        })
      ).status,
    ).toBe(409);
    count = (await command('start')).body;
    count = (
      await save([
        { productId, quantity: '45' },
        { productId: otherId, quantity: '0' },
      ])
    ).body;
    count = (await command('review')).body;
    expect((await adjust('1')).status).toBe(201);
    expect((await adjust('-1')).status).toBe(201);
    expect(
      (
        await manager.request('/stock-counts/' + count.id + '/finalize', {
          requestId: requestId(),
          version: count.version,
        })
      ).status,
    ).toBe(409);
    expect(
      (await db.pool.query('SELECT count(*) FROM movements WHERE stock_count_id=$1', [count.id]))
        .rows[0].count,
    ).toBe('0');
    count = (await command('recount')).body;
    expect(count.lines.every((l: any) => l.counted_quantity === null)).toBe(true);
    count = (
      await save([
        { productId, quantity: '45' },
        { productId: otherId, quantity: '0' },
      ])
    ).body;
    count = (await command('review')).body;
    const r = await manager.request('/stock-counts/' + count.id + '/finalize', {
      requestId: requestId(),
      version: count.version,
    });
    expect(r.status).toBe(201);
    expect(
      (await db.pool.query('SELECT stock FROM products WHERE id=$1', [otherId])).rows[0].stock,
    ).toBe('0.000');
  });
  it('enforces permissions, product scope, and cancellation without stock changes', async () => {
    expect(
      (
        await manager.request('/stock-counts', {
          requestId: requestId(),
          name: 'Invalid',
          productIds: [requestId()],
        })
      ).status,
    ).toBe(400);
    const roles = (await manager.request('/team/roles')).body;
    await manager.request('/team', {
      name: 'Cashier',
      employeeCode: 'C',
      roleId: roles.find((r: any) => r.name === 'Cashier').id,
      pin: '123456',
      email: 'cashier@count.test',
      password: 'cashier-password-12345',
    });
    const cashier = new Client();
    await cashier.request('/auth/login', {
      email: 'cashier@count.test',
      password: 'cashier-password-12345',
    });
    expect(
      (
        await cashier.request('/stock-counts', {
          requestId: requestId(),
          name: 'Denied',
          productIds: [productId],
        })
      ).status,
    ).toBe(403);
    count = (
      await manager.request('/stock-counts', {
        requestId: requestId(),
        name: 'Cancel',
        productIds: [productId],
      })
    ).body;
    expect((await command('cancel')).status).toBe(400);
    expect(
      (
        await manager.request('/stock-counts/' + count.id + '/action', {
          requestId: requestId(),
          version: count.version,
          action: 'cancel',
          reason: 'Wrong selection',
        })
      ).body.status,
    ).toBe('cancelled');
    expect(
      (await db.pool.query('SELECT stock FROM products WHERE id=$1', [productId])).rows[0].stock,
    ).toBe('45.000');
  });
});
