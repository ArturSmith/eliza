import { beforeAll, afterAll, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
import { validateProduction } from '../apps/api/dist/production.js';
const originalEnv = { ...process.env };
const admin = new Database();
const name = `eliza_deploy_test_${Date.now()}`;
let apps: Awaited<ReturnType<typeof createApp>>[] = [];
let urls: string[] = [];
beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE ${name}`);
  const url = new URL(
    process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza',
  );
  url.pathname = '/' + name;
  process.env.DATABASE_URL = url.toString();
  execFileSync(process.execPath, ['apps/api/dist/migrate.js'], { env: process.env });
  process.env.SERVE_WEB = 'true';
  process.env.SETUP_TOKEN = 'test-only-setup-secret-32-characters-long';
  // The isolated local fixture uses development database credentials.
  process.env.NODE_ENV = 'test';
  for (let i = 0; i < 2; i++) {
    const app = await createApp();
    await app.listen(0, '127.0.0.1');
    apps.push(app);
    urls.push(await app.getUrl());
  }
});
afterAll(async () => {
  for (const app of apps) await app.close();
  process.env = originalEnv;
  await admin.pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.onModuleDestroy();
});
const headers = {
  Origin: 'http://localhost:5173',
  'X-Eliza-Request': '1',
  'Content-Type': 'application/json',
};
it('serves SPA deep links while preserving API errors and health', async () => {
  const page = await fetch(urls[0] + '/analytics');
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('<div id="root">');
  const missing = await fetch(urls[0] + '/api/not-real');
  expect(missing.status).toBe(404);
  expect(missing.headers.get('content-type')).toContain('application/json');
  expect((await fetch(urls[0] + '/api/health')).status).toBe(200);
});
it('protects setup and uses secure production cookies', async () => {
  const body = JSON.stringify({
    storeName: 'Deploy test',
    ownerName: 'Owner',
    email: 'owner@deploy.test',
    password: 'SecurePass123!',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  });
  const denied = await fetch(urls[0] + '/api/auth/setup', { method: 'POST', headers, body });
  expect(denied.status).toBe(403);
  const badOrigin = await fetch(urls[0] + '/api/auth/setup', {
    method: 'POST',
    headers: {
      ...headers,
      Origin: 'https://untrusted.test',
      'X-Eliza-Setup-Token': process.env.SETUP_TOKEN!,
    },
    body,
  });
  expect(badOrigin.status).toBe(403);
  process.env.NODE_ENV = 'production';
  const created = await fetch(urls[0] + '/api/auth/setup', {
    method: 'POST',
    headers: { ...headers, 'X-Eliza-Setup-Token': process.env.SETUP_TOKEN! },
    body,
  });
  expect(created.status).toBe(201);
  expect(created.headers.get('set-cookie')).toContain('Secure');
  expect(created.headers.get('set-cookie')).toContain('HttpOnly');
  process.env.NODE_ENV = 'test';
});
it('shares authentication throttling across instances and ignores untrusted forwarded IPs', async () => {
  const body = JSON.stringify({ email: 'nobody@test.test', password: 'WrongPassword123!' });
  let last: Response | undefined;
  for (let i = 0; i < 21; i++) {
    last = await fetch(urls[i % 2] + '/api/auth/login', {
      method: 'POST',
      headers: { ...headers, 'X-Forwarded-For': `192.0.2.${i}` },
      body,
    });
  }
  expect(last!.status).toBe(429);
});
it('rejects unsafe production configuration', () => {
  process.env.NODE_ENV = 'production';
  expect(() => validateProduction()).toThrow();
  process.env.APP_ORIGIN = 'https://eliza.example.test';
  process.env.DATABASE_URL = 'postgresql://app:private-secret@database:5432/eliza';
  expect(() => validateProduction()).not.toThrow();
  process.env.NODE_ENV = 'test';
});
