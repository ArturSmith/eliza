import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';

const source = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
if (!['127.0.0.1', 'localhost'].includes(new URL(source).hostname))
  throw new Error('Local PostgreSQL is required.');
const previousRegistration = process.env.ALLOW_REGISTRATION;
const admin = new Database();
const name = `eliza_remote_shift_${Date.now()}`;
let db: Database, app: Awaited<ReturnType<typeof createApp>>, url: string;
class Client {
  cookies = new Map<string, string>();
  async request(path: string, body?: unknown) {
    const response = await fetch(url + '/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        'X-Eliza-Request': '1',
        'Content-Type': 'application/json',
        Cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [key, value] = cookie.split(';')[0].split('=');
      if (value) this.cookies.set(key, value);
      else this.cookies.delete(key);
    }
    return { status: response.status, body: await response.json() };
  }
}
const owner = new Client(),
  otherOwner = new Client(),
  register = new Client(),
  reader = new Client();
let shiftId: string, ownerId: string, cashierId: string, storeId: string;
const account = {
  storeName: 'Remote closing shop',
  ownerName: 'Owner',
  email: 'remote-owner@test.example',
  password: 'owner-password-12345',
  currency: 'NOK',
  timezone: 'Europe/Oslo',
};
const closing = () => ({
  requestId: crypto.randomUUID(),
  countedCash: '100',
  notes: 'Counted by manager',
});
async function openShift() {
  const result = await register.request('/pos/shifts', {
    requestId: crypto.randomUUID(),
    openingCash: '100',
  });
  expect(result.status).toBe(201);
  return result.body.id as string;
}
beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE ${name}`);
  const target = new URL(source);
  target.pathname = '/' + name;
  process.env.DATABASE_URL = target.toString();
  process.env.ALLOW_REGISTRATION = 'true';
  execFileSync(process.execPath, ['apps/api/dist/migrate.js'], { env: process.env });
  db = new Database();
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
  expect((await owner.request('/auth/setup', account)).status).toBe(201);
  const session = (await owner.request('/auth/session')).body;
  ownerId = session.user.id;
  storeId = session.store.id;
  // A viewer can read shifts and operate cash but cannot approve/close another cashier's shift.
  const role = (
    await db.pool.query(
      "INSERT INTO roles(store_id,name,permissions) VALUES($1,'Shift viewer',$2) RETURNING id",
      [storeId, JSON.stringify(['pos.access', 'sales.read', 'cash.manage'])],
    )
  ).rows[0].id;
  const employee = await owner.request('/team', {
    name: 'Remote cashier',
    employeeCode: 'REMOTE',
    roleId: role,
    pin: '123456',
    email: 'shift-viewer@test.example',
    password: 'viewer-password-12345',
  });
  expect(employee.status).toBe(201);
  cashierId = employee.body.id;
  await reader.request('/auth/login', {
    email: 'shift-viewer@test.example',
    password: 'viewer-password-12345',
  });
  await register.request('/auth/login', { email: account.email, password: account.password });
  expect((await register.request('/pos/enroll', { name: 'Remote checkout' })).status).toBe(201);
  expect(
    (await register.request('/pos/login', { employeeCode: 'REMOTE', pin: '123456' })).status,
  ).toBe(200);
  expect(
    (
      await otherOwner.request('/auth/register', {
        ...account,
        storeName: 'Other shop',
        email: 'other-remote@test.example',
      })
    ).status,
  ).toBe(201);
  shiftId = await openShift();
});
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.onModuleDestroy();
  process.env.DATABASE_URL = source;
  if (previousRegistration === undefined) delete process.env.ALLOW_REGISTRATION;
  else process.env.ALLOW_REGISTRATION = previousRegistration;
  await admin.pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.onModuleDestroy();
});
describe.sequential('management shift closing', () => {
  it('requires management authentication and approval permission and scopes every lookup to the shop', async () => {
    expect((await new Client().request(`/reports/shifts/${shiftId}/close`, closing())).status).toBe(
      401,
    );
    expect((await register.request(`/reports/shifts/${shiftId}/close`, closing())).status).toBe(
      401,
    );
    expect((await reader.request(`/reports/shifts/${shiftId}`)).status).toBe(200);
    expect(
      (
        await reader.request(`/reports/shifts/${shiftId}/close`, {
          ...closing(),
          approval: { employeeCode: 'OWNER', pin: '123456' },
        })
      ).status,
    ).toBe(403);
    expect((await otherOwner.request(`/reports/shifts/${shiftId}`)).status).toBe(404);
    expect((await otherOwner.request(`/reports/shifts/${shiftId}/close`, closing())).status).toBe(
      404,
    );
    expect(
      (await owner.request(`/reports/shifts/${crypto.randomUUID()}/close`, closing())).status,
    ).toBe(404);
    expect((await owner.request('/reports/shifts/not-a-uuid/close', closing())).status).toBe(400);
    for (const countedCash of ['', '-1', 'abc', '1.234'])
      expect(
        (await owner.request(`/reports/shifts/${shiftId}/close`, { ...closing(), countedCash }))
          .status,
      ).toBe(400);
    expect(
      (
        await owner.request(`/reports/shifts/${shiftId}/close`, {
          ...closing(),
          notes: 'x'.repeat(501),
        })
      ).status,
    ).toBe(400);
    expect((await owner.request(`/reports/shifts/${shiftId}`)).body.status).toBe('open');
  });
  it('closes the actual drawer count, keeps the original cashier and records the manager in the audit', async () => {
    expect(
      (
        await register.request('/pos/cash', {
          requestId: crypto.randomUUID(),
          amount: '25',
          direction: 'in',
          reason: 'Extra change',
        })
      ).status,
    ).toBe(201);
    expect((await owner.request(`/reports/shifts/${shiftId}`)).body.expectedCash).toBe('125.00');
    const body = { ...closing(), countedCash: '120', notes: 'Five short after physical count' };
    const result = await owner.request(`/reports/shifts/${shiftId}/close`, body);
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      id: shiftId,
      status: 'closed',
      cashierId,
      employeeName: 'Remote cashier',
      expectedCash: '125.00',
      countedCash: '120.00',
      difference: '-5.00',
      notes: body.notes,
    });
    const stored = (
      await db.pool.query('SELECT employee_id,approver_id FROM shifts WHERE id=$1', [shiftId])
    ).rows[0];
    expect(stored).toEqual({ employee_id: cashierId, approver_id: ownerId });
    const audits = (
      await db.pool.query(
        "SELECT employee_id,details FROM audits WHERE entity_id=$1 AND action='Shift closed'",
        [shiftId],
      )
    ).rows;
    expect(audits).toHaveLength(1);
    expect(audits[0].employee_id).toBe(ownerId);
    expect(audits[0].details).toMatchObject({
      source: 'management',
      cashierId,
      countedCash: '120',
      difference: '-5.00',
    });
    const retry = await owner.request(`/reports/shifts/${shiftId}/close`, body);
    expect(retry.status).toBe(201);
    expect(retry.body.closedAt).toBe(result.body.closedAt);
    expect(
      (await owner.request(`/reports/shifts/${shiftId}/close`, { ...body, countedCash: '121' }))
        .status,
    ).toBe(409);
    expect((await owner.request(`/reports/shifts/${shiftId}/close`, closing())).status).toBe(409);
    expect((await register.request('/pos/enter', {})).body.shift).toBeNull();
    expect(
      (
        await register.request('/pos/cash', {
          requestId: crypto.randomUUID(),
          amount: '1',
          direction: 'in',
          reason: 'Too late',
        })
      ).status,
    ).toBe(409);
    await expect(
      db.pool.query('UPDATE shifts SET counted_cash=0 WHERE id=$1', [shiftId]),
    ).rejects.toThrow('immutable');
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM audits WHERE entity_id=$1 AND action='Shift closed'",
          [shiftId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('serializes duplicate and conflicting concurrent close requests without rewriting the result', async () => {
    const id = await openShift(),
      body = closing();
    const duplicate = await Promise.all([
      owner.request(`/reports/shifts/${id}/close`, body),
      owner.request(`/reports/shifts/${id}/close`, body),
    ]);
    expect(duplicate.map((r) => r.status)).toEqual([201, 201]);
    expect(duplicate[0].body.closedAt).toBe(duplicate[1].body.closedAt);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM audits WHERE entity_id=$1 AND action='Shift closed'",
          [id],
        )
      ).rows[0].n,
    ).toBe(1);
    const next = await openShift();
    const conflict = await Promise.all([
      owner.request(`/reports/shifts/${next}/close`, closing()),
      owner.request(`/reports/shifts/${next}/close`, { ...closing(), countedCash: '99' }),
    ]);
    expect(conflict.map((r) => r.status).sort()).toEqual([201, 409]);
  });
  it('serializes a cash movement with remote closing and freezes the final ledger total', async () => {
    const id = await openShift();
    const [movement, closed] = await Promise.all([
      register.request('/pos/cash', {
        requestId: crypto.randomUUID(),
        amount: '10',
        direction: 'in',
        reason: 'Concurrent change',
      }),
      owner.request(`/reports/shifts/${id}/close`, closing()),
    ]);
    expect([201, 409]).toContain(movement.status);
    expect(closed.status).toBe(201);
    expect(closed.body.expectedCash).toBe(movement.status === 201 ? '110.00' : '100.00');
    const ledger = (
      await db.pool.query(
        'SELECT sum(amount)::numeric(14,2)::text AS total FROM cash_movements WHERE shift_id=$1',
        [id],
      )
    ).rows[0].total;
    expect(closed.body.expectedCash).toBe(ledger);
    expect((await owner.request(`/reports/shifts/${id}`)).body).toEqual(closed.body);
  });
});
