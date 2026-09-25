import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';

const admin = new Database();
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_tags_test_${Date.now()}`;
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
        Cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '),
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

describe.sequential('Price Tags station', () => {
  const manager = new Client();
  it('limits the employee list and product access to an assigned device and PIN session', async () => {
    expect(
      (
        await manager.request('/auth/setup', {
          storeName: 'Tag test',
          ownerName: 'Owner',
          email: 'tags@test.example',
          password: 'owner-password-12345',
          currency: 'NOK',
          timezone: 'Europe/Oslo',
        })
      ).status,
    ).toBe(201);
    const session = (await manager.request('/auth/session')).body;
    const roles = (await manager.request('/team/roles')).body;
    const cashierRole = roles.find((role: { name: string }) => role.name === 'Cashier');
    expect(
      (
        await manager.request('/team', {
          name: 'Alex',
          employeeCode: 'ALEX',
          roleId: cashierRole.id,
          pin: '123456',
          roleIds: [
            cashierRole.id,
            roles.find((role: { name: string }) => role.name === 'General employee').id,
          ],
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await manager.request('/team', {
          name: 'Sam',
          employeeCode: 'SAM',
          roleId: cashierRole.id,
          pin: '654321',
        })
      ).status,
    ).toBe(201);
    const product = await manager.request('/products', {
      name: 'Milk',
      sku: 'MILK',
      category: 'Dairy',
      unit: 'piece',
      price: '12',
      cost: '8',
      minStock: '0',
      barcodes: [],
      plu: '',
    });
    expect(product.status).toBe(201);
    expect(
      (
        await manager.request(
          `/devices/${session.device.id}`,
          { name: 'Tag station', active: true, type: 'price_tags' },
          'PATCH',
        )
      ).status,
    ).toBe(200);
    expect((await manager.request('/auth/device-environment')).body.type).toBe('price_tags');
    expect((await manager.request('/products')).status).toBe(401);
    const context = await manager.request('/price-tags/context');
    expect(context.status).toBe(200);
    expect(context.body.employees.map((employee: { name: string }) => employee.name)).toEqual([
      'Alex',
    ]);
    expect(context.body.operator).toBeNull();
    expect((await manager.request('/price-tags/products')).status).toBe(401);
    expect(
      (await manager.request('/price-tags/login', { employeeCode: 'SAM', pin: '654321' })).status,
    ).toBe(401);
    expect(
      (await manager.request('/price-tags/login', { employeeCode: 'ALEX', pin: '123456' })).status,
    ).toBe(200);
    const products = await manager.request('/price-tags/products');
    expect(products.status).toBe(200);
    expect(products.body).toMatchObject([{ id: product.body.id, price: '12.00' }]);
    const printed = await manager.request('/price-tags/prints', { productIds: [product.body.id] });
    expect(printed.status).toBe(201);
    expect(printed.body.products[0].price).toBe('12.00');
    expect((await manager.request('/price-tags/lock', {})).status).toBe(200);
    expect((await manager.request('/price-tags/products')).status).toBe(401);
    expect(
      (
        await manager.request('/auth/reclaim-device', {
          email: 'tags@test.example',
          password: 'wrong-password',
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await manager.request('/auth/reclaim-device', {
          email: 'tags@test.example',
          password: 'owner-password-12345',
        })
      ).status,
    ).toBe(200);
    expect((await manager.request('/auth/device-environment')).body.type).toBe('management');
    expect((await manager.request('/auth/session')).status).toBe(200);
    expect((await manager.request('/price-tags/context')).status).toBe(403);
    expect(
      (
        await manager.request(
          `/devices/${session.device.id}`,
          { name: 'Checkout station', active: true, type: 'pos' },
          'PATCH',
        )
      ).status,
    ).toBe(200);
    expect(
      (await manager.request('/pos/login', { employeeCode: 'ALEX', pin: '123456' })).status,
    ).toBe(200);
    expect(
      (await manager.request('/pos/shifts', { requestId: crypto.randomUUID(), openingCash: '0' }))
        .status,
    ).toBe(201);
    expect(
      (
        await manager.request('/auth/reclaim-device', {
          email: 'tags@test.example',
          password: 'owner-password-12345',
        })
      ).status,
    ).toBe(409);
    expect((await manager.request('/auth/device-environment')).body.type).toBe('pos');
  });
});
