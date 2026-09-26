import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
const admin = new Database();
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_expenses_test_${Date.now()}`;
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
describe.sequential('Expenses', () => {
  const owner = new Client(),
    other = new Client();
  let expense: any;
  const body = {
    date: '2026-09-26',
    description: 'Shop rent',
    category: 'Rent',
    amount: '1200.50',
    paymentMethod: 'bank',
    payee: 'Landlord',
    reference: 'SEP-26',
    notes: 'September',
  };
  it('creates shop-scoped entries and accurate filtered totals', async () => {
    expect(
      (
        await owner.request('/auth/setup', {
          storeName: 'Expense shop',
          ownerName: 'Owner',
          email: 'expenses@test.example',
          password: 'owner-password-12345',
          currency: 'NOK',
          timezone: 'Europe/Oslo',
        })
      ).status,
    ).toBe(201);
    const session = (await owner.request('/auth/session')).body;
    const secondStore = (
      await db.pool.query(
        "INSERT INTO stores(organization_id,name,currency,timezone) SELECT organization_id,'Other shop',currency,timezone FROM stores WHERE id=$1 RETURNING id",
        [session.store.id],
      )
    ).rows[0];
    const role = (
      await db.pool.query(
        "INSERT INTO roles(store_id,name,permissions) SELECT $1,'Owner',permissions FROM roles WHERE store_id=$2 AND name='Owner' RETURNING id",
        [secondStore.id, session.store.id],
      )
    ).rows[0];
    await db.pool.query(
      "INSERT INTO employees(store_id,role_id,name,email,password_hash) SELECT $1,$2,'Other owner','other-expenses@test.example',password_hash FROM employees WHERE id=$3",
      [secondStore.id, role.id, session.user.id],
    );
    expect(
      (
        await other.request('/auth/login', {
          email: 'other-expenses@test.example',
          password: 'owner-password-12345',
        })
      ).status,
    ).toBe(200);
    const created = await owner.request('/expenses', body);
    expect(created.status).toBe(201);
    expense = created.body;
    expect(expense.amount).toBe('1200.50');
    expect((await owner.request('/expenses', { ...body, amount: '0' })).status).toBe(400);
    expect((await owner.request('/expenses', { ...body, date: '2026-02-30' })).status).toBe(400);
    expect((await owner.request('/expenses?from=2026-09-01&to=2026-09-30')).body).toMatchObject({
      count: 1,
      total: '1200.50',
    });
    expect((await owner.request('/expenses?to=2026-09-25')).body.count).toBe(0);
    expect((await owner.request('/expenses?search=landlord')).body.count).toBe(1);
    expect((await owner.request('/expenses?from=2026-10-01&to=2026-09-01')).status).toBe(400);
    expect((await other.request('/expenses')).body).toMatchObject({ count: 0, total: '0' });
    expect(
      (await other.request('/expenses/' + expense.id, { ...body, version: 1 }, 'PATCH')).status,
    ).toBe(404);
    expect((await other.request('/expenses/' + expense.id, { version: 1 }, 'DELETE')).status).toBe(
      404,
    );
  });
  it('detects concurrent edits and retains audit history after deletion', async () => {
    const updated = await owner.request(
      '/expenses/' + expense.id,
      { ...body, amount: '1300.75', version: 1 },
      'PATCH',
    );
    expect(updated.status).toBe(200);
    expect(updated.body.version).toBe(2);
    expect(
      (await owner.request('/expenses/' + expense.id, { ...body, version: 1 }, 'PATCH')).status,
    ).toBe(409);
    expect((await owner.request('/expenses/' + expense.id, { version: 1 }, 'DELETE')).status).toBe(
      409,
    );
    expect((await owner.request('/expenses/' + expense.id, { version: 2 }, 'DELETE')).status).toBe(
      200,
    );
    expect((await owner.request('/expenses')).body).toMatchObject({ count: 0, total: '0' });
    const records = await db.pool.query(
      'SELECT action FROM audits WHERE entity_id=$1 ORDER BY created_at',
      [expense.id],
    );
    expect(records.rows.map((r) => r.action)).toEqual([
      'Expense created',
      'Expense updated',
      'Expense deleted',
    ]);
  });
  it('paginates without losing totals and rejects simultaneous stale edits', async () => {
    const session = (await owner.request('/auth/session')).body;
    await db.pool.query(
      "INSERT INTO expenses(store_id,expense_date,description,category,amount,payment_method) SELECT $1,'2026-09-26','Small expense '||n,'Other',0.01,'cash' FROM generate_series(1,51) n",
      [session.store.id],
    );
    const first = (await owner.request('/expenses?page=1')).body,
      second = (await owner.request('/expenses?page=2')).body;
    expect(first.rows).toHaveLength(50);
    expect(second.rows).toHaveLength(1);
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(51);
    expect(first.total).toBe('0.51');
    expect(second.total).toBe('0.51');
    expect(first.count).toBe(51);
    const entry = first.rows[0];
    const replies = await Promise.all(
      ['0.02', '0.03'].map((amount) =>
        owner.request('/expenses/' + entry.id, { ...entry, amount }, 'PATCH'),
      ),
    );
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    const saved = (
      await db.pool.query('SELECT amount,version FROM expenses WHERE id=$1', [entry.id])
    ).rows[0];
    expect(saved.version).toBe(2);
    expect(saved.amount).toBe(replies.find((r) => r.status === 200)!.body.amount);
  });

  it('denies access without expense permissions', async () => {
    const session = (await other.request('/auth/session')).body;
    await db.pool.query("UPDATE roles SET permissions='[]'::jsonb WHERE store_id=$1", [
      session.store.id,
    ]);
    expect((await other.request('/expenses')).status).toBe(403);
    expect((await other.request('/expenses', body)).status).toBe(403);
  });
});
