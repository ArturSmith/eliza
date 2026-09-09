import { readFileSync, rmSync, statSync } from 'node:fs';
import { verifyPassword } from '../apps/api/dist/security.js';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
const admin = new Database();
const original = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const name = `eliza_ops_test_${Date.now()}`;
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
let archive: string, restoredName: string, credentialFile: string;
const account = {
  storeName: 'Operations test',
  ownerName: 'Owner',
  email: 'owner@operations.test',
  password: 'original-password-12345',
  currency: 'NOK',
  timezone: 'Europe/Oslo',
};
function run(script: string, args: string[] = []) {
  return JSON.parse(
    execFileSync(process.execPath, [script, ...args], {
      env: process.env,
      encoding: 'utf8',
    }).trim(),
  );
}
afterAll(async () => {
  if (archive) {
    rmSync(archive, { force: true });
    rmSync(archive + '.json', { force: true });
  }
  if (credentialFile) rmSync(credentialFile, { force: true });
  if (restoredName) {
    const cleanup = new Database();
    try {
      await cleanup.pool.query(`DROP DATABASE IF EXISTS "${restoredName}" WITH (FORCE)`);
    } finally {
      await cleanup.onModuleDestroy();
    }
  }
});
describe.sequential('local recovery tools', () => {
  it('creates a private consistent backup and restores it without changing the source', async () => {
    expect((await manager.request('/auth/setup', account)).status).toBe(201);
    const product = (
      await manager.request('/products', {
        name: 'Backup item',
        sku: 'BACKUP',
        category: 'Test',
        unit: 'piece',
        price: '1',
        cost: '0.5',
        minStock: '0',
        barcodes: [],
        plu: '',
      })
    ).body;
    expect(
      (
        await manager.request('/inventory/adjustments', {
          requestId: crypto.randomUUID(),
          productId: product.id,
          quantity: '2',
          reason: 'opening_balance',
        })
      ).status,
    ).toBe(201);
    const report = run('scripts/readiness.mjs');
    expect(Object.values(report.ledger).every((v) => v === 0)).toBe(true);
    const backup = run('scripts/backup.mjs', ['create']);
    archive = backup.backup;
    expect(statSync(archive).mode & 0o777).toBe(0o600);
    const before = (await db.pool.query('SELECT count(*)::text AS n FROM sessions')).rows[0].n;
    const verified = run('scripts/backup.mjs', ['verify', archive]);
    expect(verified.sourceDatabaseUnchanged).toBe(true);
    expect(verified.tables).toBeGreaterThan(10);
    const restored = run('scripts/backup.mjs', ['restore-new', archive]);
    restoredName = restored.restoredDatabase;
    expect(restored.sessionsRevoked).toBe(true);
    expect((await db.pool.query('SELECT count(*)::text AS n FROM sessions')).rows[0].n).toBe(
      before,
    );
    const target = new URL(process.env.DATABASE_URL!);
    target.pathname = '/' + restoredName;
    const { default: pg } = await import('../apps/api/node_modules/pg/lib/index.js');
    const check = new pg.Client({ connectionString: target.toString() });
    await check.connect();
    try {
      expect((await check.query('SELECT count(*)::text AS n FROM sessions')).rows[0].n).toBe('0');
      expect((await check.query('SELECT count(*)::text AS n FROM employees')).rows[0].n).toBe('1');
    } finally {
      await check.end();
    }
  });
  it('recovers only the disposable owner, revokes sessions and audits without exposing the password', async () => {
    expect(() => run('scripts/recover-owner.mjs', [account.email])).toThrow();
    const result = run('scripts/recover-owner.mjs', [account.email, '--confirm-local-recovery']);
    credentialFile = result.credentialFile;
    expect(statSync(credentialFile).mode & 0o777).toBe(0o600);
    const password = readFileSync(credentialFile, 'utf8').trim();
    expect(JSON.stringify(result)).not.toContain(password);
    const employee = (
      await db.pool.query('SELECT password_hash FROM employees WHERE email=$1', [account.email])
    ).rows[0];
    expect(await verifyPassword(password, employee.password_hash)).toBe(true);
    expect((await manager.request('/auth/session')).status).toBe(401);
    expect((await manager.request('/auth/login', { email: account.email, password })).status).toBe(
      200,
    );
    const audit = (
      await db.pool.query(
        "SELECT details FROM audits WHERE action='Owner password recovered locally'",
      )
    ).rows;
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(password);
  });

  it('health rejects missing migrations rather than claiming the app is ready', async () => {
    const row = (await db.pool.query('SELECT name,checksum FROM schema_migrations LIMIT 1'))
      .rows[0];
    await db.pool.query("UPDATE schema_migrations SET checksum='invalid' WHERE name=$1", [
      row.name,
    ]);
    expect((await manager.request('/health')).status).toBe(503);
    await db.pool.query('UPDATE schema_migrations SET checksum=$2 WHERE name=$1', [
      row.name,
      row.checksum,
    ]);
    expect((await manager.request('/health')).status).toBe(200);
  });
});
