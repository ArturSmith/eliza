import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';

const admin = new Database();
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_device_removal_${Date.now()}`;
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
    for (const item of response.headers.getSetCookie()) {
      const [key, value] = item.split(';')[0].split('=');
      if (value) this.cookies.set(key, value);
      else this.cookies.delete(key);
    }
    return { status: response.status, body: await response.json() };
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

describe('device removal', () => {
  it('revokes the device, retains history, and permits new registration', async () => {
    const manager = new Client();
    const browser = new Client();
    const credentials = { email: 'devices@test.example', password: 'owner-password-12345' };
    expect(
      (
        await manager.request('/auth/setup', {
          storeName: 'Device test',
          ownerName: 'Owner',
          ...credentials,
          currency: 'NOK',
          timezone: 'Europe/Oslo',
        })
      ).status,
    ).toBe(201);
    expect((await browser.request('/auth/login', credentials)).status).toBe(200);
    const oldId = (await browser.request('/auth/session')).body.device.id;
    expect(
      (
        await manager.request(
          `/devices/${oldId}`,
          { name: 'Second browser', type: 'management', active: true },
          'PATCH',
        )
      ).status,
    ).toBe(200);
    const product = await manager.request('/products', {
      name: 'Test milk',
      sku: 'MILK-DEVICE',
      category: 'Dairy',
      unit: 'piece',
      price: '29.90',
      cost: '16.50',
      minStock: '5',
      barcodes: [],
    });
    expect(product.status).toBe(201);
    const movement = await browser.request('/inventory/adjustments', {
      productId: product.body.id,
      quantity: '2',
      reason: 'opening_balance',
      requestId: crypto.randomUUID(),
    });
    expect(movement.status).toBe(201);
    expect((await browser.request('/pos/activate', {})).status).toBe(200);
    expect((await browser.request('/auth/device-environment')).body.type).toBe('pos');
    expect((await browser.request('/pos/enter', {})).body.registered).toBe(true);
    expect((await browser.request('/auth/session')).status).toBe(401);
    expect(
      (await manager.request('/devices')).body.find(
        (device: { id: string; type: string }) => device.id === oldId,
      ).type,
    ).toBe('pos');
    expect((await manager.request(`/devices/${oldId}`, undefined, 'DELETE')).status).toBe(200);
    expect((await db.pool.query('SELECT id FROM devices WHERE id=$1', [oldId])).rowCount).toBe(0);
    expect(
      (await db.pool.query('SELECT id FROM device_records WHERE id=$1', [oldId])).rowCount,
    ).toBe(1);
    expect((await browser.request('/auth/session')).status).toBe(401);
    expect(
      (await manager.request('/devices')).body.some(
        (device: { id: string }) => device.id === oldId,
      ),
    ).toBe(false);
    expect(
      (await manager.request(`/devices/${oldId}`, { name: 'Old', active: true }, 'PATCH')).status,
    ).toBe(404);
    expect((await browser.request('/auth/login', credentials)).status).toBe(200);
    expect((await browser.request('/auth/session')).body.device.id).not.toBe(oldId);
    const movements = (await manager.request('/inventory/movements')).body;
    expect(
      movements.some(
        (entry: { device: string; productId: string }) =>
          entry.device === 'Second browser' && entry.productId === product.body.id,
      ),
    ).toBe(true);
    const audit = (await manager.request('/audit')).body;
    expect(
      audit.some(
        (entry: { action: string; entityId: string }) =>
          entry.action === 'Device removed' && entry.entityId === oldId,
      ),
    ).toBe(true);
  });
});
