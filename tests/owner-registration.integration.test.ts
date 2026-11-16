import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Database } from '../apps/api/dist/database.js';
import { createApp } from '../apps/api/dist/app.js';
const original = { ...process.env };
const source = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = 'eliza_registration_' + randomUUID().replaceAll('-', '');
const admin = new Database();
let db: Database, app: Awaited<ReturnType<typeof createApp>>, url: string;
class Client {
  cookies = new Map<string, string>();
  async request(
    path: string,
    data?: unknown,
    method = data === undefined ? 'GET' : 'POST',
    origin = 'http://localhost:5173',
  ) {
    const response = await fetch(url + '/api' + path, {
      method,
      headers: {
        Origin: origin,
        'X-Eliza-Request': '1',
        'Content-Type': 'application/json',
        Cookie: [...this.cookies].map(([k, v]) => k + '=' + v).join('; '),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    for (const item of response.headers.getSetCookie()) {
      const [key, value] = item.split(';')[0].split('=');
      if (value) this.cookies.set(key, value);
      else this.cookies.delete(key);
    }
    return {
      status: response.status,
      body: await response.json(),
      cookies: response.headers.getSetCookie(),
    };
  }
}
const account = (email: string) => ({
  storeName: 'Independent store',
  ownerName: email.split('@')[0],
  email,
  password: 'test-password-12345',
  currency: 'NOK',
  timezone: 'Europe/Oslo',
});
const a = new Client(),
  b = new Client(),
  pos = new Client();
let storeA: string,
  storeB: string,
  employeeA: string,
  roleA: string,
  productA: string,
  productB: string,
  saleId: string;
const profile = {
  name: 'Same product',
  sku: 'SAME-SKU',
  category: 'Dairy',
  unit: 'piece',
  price: '100',
  taxRate: '0',
  minStock: '0',
  barcodes: ['1234567890128'],
};
beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${name}"`);
  const target = new URL(source);
  target.pathname = '/' + name;
  process.env.DATABASE_URL = target.toString();
  process.env.NODE_ENV = 'test';
  delete process.env.ALLOW_REGISTRATION;
  delete process.env.ELIZA_DESKTOP;
  execFileSync(process.execPath, ['apps/api/dist/migrate.js'], { env: process.env, stdio: 'pipe' });
  db = new Database();
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
  await db?.onModuleDestroy();
  process.env = original;
  await admin.pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.onModuleDestroy();
});
describe.sequential('opt-in independent owner registration', () => {
  it('keeps registration closed by default and preserves protected bootstrap', async () => {
    expect((await a.request('/auth/status')).body).toMatchObject({
      needsSetup: true,
      registrationEnabled: false,
    });
    expect((await a.request('/auth/register', account('denied@example.test'))).status).toBe(403);
    process.env.SETUP_TOKEN = 'test-bootstrap-token-at-least-32-characters';
    expect((await a.request('/auth/setup', account('denied@example.test'))).status).toBe(403);
    expect((await db.pool.query('SELECT count(*)::int AS n FROM organizations')).rows[0].n).toBe(0);
  });
  it('creates two complete tenants without requiring the bootstrap secret or reusing the first owner device', async () => {
    process.env.ALLOW_REGISTRATION = 'true';
    expect((await a.request('/auth/register', account('first@example.test'))).status).toBe(201);
    const sessionA = (await a.request('/auth/session')).body;
    storeA = sessionA.store.id;
    employeeA = sessionA.user.id;
    roleA = (await a.request('/team/roles')).body.find((role: any) => role.name === 'Owner').id;
    b.cookies = new Map(a.cookies);
    expect(
      (
        await b.request('/auth/register', {
          ...account('second@example.test'),
          storeId: storeA,
          roleId: roleA,
        })
      ).status,
    ).toBe(201);
    const sessionB = (await b.request('/auth/session')).body;
    storeB = sessionB.store.id;
    expect(storeB).not.toBe(storeA);
    expect(sessionB.device.id).not.toBe(sessionA.device.id);
    expect((await a.request('/auth/session')).body.store.id).toBe(storeA);
    expect((await db.pool.query('SELECT count(*)::int AS n FROM organizations')).rows[0].n).toBe(2);
    for (const id of [storeA, storeB]) {
      expect(
        (await db.pool.query('SELECT count(*)::int AS n FROM roles WHERE store_id=$1', [id]))
          .rows[0].n,
      ).toBe(4);
      expect(
        (
          await db.pool.query('SELECT count(*)::int AS n FROM employee_roles WHERE store_id=$1', [
            id,
          ])
        ).rows[0].n,
      ).toBe(2);
    }
  });
  it('rejects duplicate emails, invalid inputs and foreign origins without leaving orphan stores', async () => {
    const before = (await db.pool.query('SELECT count(*)::int AS n FROM organizations')).rows[0].n;
    const duplicate = await new Client().request('/auth/register', account('FIRST@example.test'));
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.message).toMatch(/already exists/);
    expect(
      (
        await new Client().request('/auth/register', {
          ...account('invalid@example.test'),
          password: 'short',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await new Client().request(
          '/auth/register',
          account('origin@example.test'),
          'POST',
          'https://untrusted.test',
        )
      ).status,
    ).toBe(403);
    expect((await db.pool.query('SELECT count(*)::int AS n FROM organizations')).rows[0].n).toBe(
      before,
    );
  });
  it('handles simultaneous duplicate registrations atomically', async () => {
    const before = (await db.pool.query('SELECT count(*)::int AS n FROM organizations')).rows[0].n;
    const results = await Promise.all(
      [new Client(), new Client()].map((client) =>
        client.request('/auth/register', account('concurrent@example.test')),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect((await db.pool.query('SELECT count(*)::int AS n FROM organizations')).rows[0].n).toBe(
      before + 1,
    );
    expect(
      (
        await db.pool.query(
          'SELECT count(*)::int AS n FROM stores WHERE organization_id NOT IN (SELECT organization_id FROM stores s JOIN employees e ON e.store_id=s.id)',
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('isolates catalog, employees, roles and stock operations between tenants', async () => {
    const first = await a.request('/products', profile);
    expect(first.status).toBe(201);
    productA = first.body.id;
    const second = await b.request('/products', { ...profile, price: '20' });
    expect(second.status).toBe(201);
    productB = second.body.id;
    expect((await a.request('/products')).body.map((product: any) => product.id)).toEqual([
      productA,
    ]);
    expect((await b.request('/products')).body.map((product: any) => product.id)).toEqual([
      productB,
    ]);
    expect(
      (await b.request('/employees')).body.some((employee: any) => employee.id === employeeA),
    ).toBe(false);
    expect((await b.request('/team/roles')).body.some((role: any) => role.id === roleA)).toBe(
      false,
    );
    expect(
      (await b.request('/products/' + productA, { ...profile, name: 'Forbidden edit' }, 'PATCH'))
        .status,
    ).toBe(404);
    expect(
      (
        await b.request('/inventory/adjustments', {
          requestId: randomUUID(),
          productId: productA,
          quantity: '1',
          reason: 'opening_balance',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await b.request('/team', {
          name: 'Foreign role',
          employeeCode: 'BAD',
          roleId: roleA,
          pin: '123456',
        })
      ).status,
    ).toBe(400);
    expect((await a.request('/products')).body[0].name).toBe('Same product');
  });
  it('keeps receipts and financial metrics store-scoped after an actual sale', async () => {
    expect(
      (
        await a.request('/inventory/adjustments', {
          requestId: randomUUID(),
          productId: productA,
          quantity: '5',
          unitCost: '60',
          reason: 'opening_balance',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await a.request(
          '/team/' + employeeA,
          { name: 'first', employeeCode: 'OWNER', roleId: roleA, active: true, pin: '123456' },
          'PATCH',
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await pos.request('/auth/login', {
          email: 'first@example.test',
          password: account('').password,
        })
      ).status,
    ).toBe(200);
    await pos.request('/pos/enroll', { name: 'Tenant A checkout' });
    await pos.request('/pos/login', { employeeCode: 'OWNER', pin: '123456' });
    const shift = (await pos.request('/pos/shifts', { requestId: randomUUID(), openingCash: '0' }))
      .body;
    const sale = await pos.request('/pos/sales', {
      requestId: randomUUID(),
      shiftId: shift.id,
      lines: [{ productId: productA, quantity: '1', expectedPrice: '100', expectedTaxRate: '0' }],
      discountPercent: '0',
      payment: { method: 'cash', tendered: '100' },
    });
    expect(sale.status).toBe(201);
    saleId = sale.body.id;
    expect((await b.request('/reports/receipt-search/' + saleId)).status).toBe(404);
    const { storeToday } = await import('../packages/contracts/src/index');
    const day = storeToday(new Date(), 'Europe/Oslo');
    const path = '/reports/financial-summary?from=' + day + '&to=' + day;
    expect((await a.request(path)).body).toMatchObject({
      revenue: '100.00',
      cogs: '60.00',
      grossProfit: '40.00',
    });
    expect((await b.request(path)).body).toMatchObject({
      revenue: '0.00',
      cogs: '0.00',
      grossProfit: '0.00',
    });
  });
  it('clears foreign checkout cookies when logging into another tenant without modifying the old register', async () => {
    const oldDevice = (await pos.request('/pos/context')).body.device.id;
    b.cookies.set('eliza_register', pos.cookies.get('eliza_register')!);
    b.cookies.set('eliza_pos_session', pos.cookies.get('eliza_pos_session')!);
    expect(
      (
        await b.request('/auth/login', {
          email: 'second@example.test',
          password: account('').password,
        })
      ).status,
    ).toBe(200);
    expect(b.cookies.has('eliza_register')).toBe(false);
    expect(b.cookies.has('eliza_pos_session')).toBe(false);
    expect((await b.request('/auth/device-environment')).body.type).toBe('management');
    expect((await b.request('/auth/session')).body.store.id).toBe(storeB);
    expect((await pos.request('/pos/context')).body.store.id).toBe(storeA);
    expect(
      (await db.pool.query('SELECT type,active FROM devices WHERE id=$1', [oldDevice])).rows[0],
    ).toMatchObject({ type: 'pos', active: true });
  });
  it('supports returning to an existing owner on the same browser', async () => {
    expect((await b.request('/auth/logout', {})).status).toBe(200);
    expect(
      (
        await b.request('/auth/login', {
          email: 'first@example.test',
          password: account('').password,
        })
      ).status,
    ).toBe(200);
    expect((await b.request('/auth/session')).body.store.id).toBe(storeA);
    expect((await b.request('/products')).body.map((product: any) => product.id)).toEqual([
      productA,
    ]);
  });
  it('can close registration again and always disables it for desktop', async () => {
    process.env.ALLOW_REGISTRATION = 'false';
    expect((await a.request('/auth/register', account('closed@example.test'))).status).toBe(403);
    process.env.ALLOW_REGISTRATION = 'true';
    process.env.ELIZA_DESKTOP = 'true';
    expect((await a.request('/auth/status')).body.registrationEnabled).toBe(false);
    expect((await a.request('/auth/register', account('desktop@example.test'))).status).toBe(403);
    delete process.env.ELIZA_DESKTOP;
    expect(
      (
        await a.request('/auth/login', {
          email: 'first@example.test',
          password: account('').password,
        })
      ).status,
    ).toBe(200);
  });
});
