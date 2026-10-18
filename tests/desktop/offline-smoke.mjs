// Run separately from browser E2E: owns ports 37931/54339 and a disposable store.
import { _electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import {
  mkdtemp,
  rm,
  copyFile,
  readdir,
  readFile,
  writeFile,
  mkdir,
  cp,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startDatabase } from '../../apps/desktop/src/runtime.mjs';
import {
  readArchive,
  verifyBackup,
  needsMigration,
  automaticBackup,
} from '../../apps/desktop/src/backup.mjs';
const require = createRequire(resolve('apps/desktop/package.json'));
const dataDir = await mkdtemp(join(tmpdir(), 'eliza-desktop-test-'));
let desktop;
const request = async (page, path, body, method = body ? 'POST' : 'GET') =>
  page.evaluate(
    async ({ path, body, method }) => {
      const response = await fetch('/api' + path, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Eliza-Request': '1' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, body, method },
  );
async function launch() {
  const env = { ...process.env, ELIZA_DESKTOP_DATA_DIR: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await _electron.launch({
    executablePath: process.env.ELIZA_DESKTOP_SMOKE_BINARY || require('electron'),
    args: [resolve('apps/desktop')],
    env,
    timeout: 120000,
  });
  const page = await desktop.firstWindow({ timeout: 120000 });
  await page.waitForLoadState('networkidle');
  return page;
}
try {
  let page = await launch();
  expect(
    await page.evaluate(async () => {
      try {
        await fetch('https://example.com');
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  const setup = await request(page, '/auth/setup', {
    storeName: 'Offline test shop',
    ownerName: 'Owner',
    email: 'offline@example.test',
    password: 'offline-test-password-123',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  });
  expect(setup.status).toBe(201);
  const session = (await request(page, '/auth/session')).body;
  const roles = (await request(page, '/team/roles')).body;
  expect(
    (
      await request(
        page,
        '/team/' + session.user.id,
        {
          name: 'Owner',
          employeeCode: 'OWNER',
          roleId: roles.find((role) => role.name === 'Owner').id,
          active: true,
          pin: '654321',
        },
        'PATCH',
      )
    ).status,
  ).toBe(200);
  const product = (
    await request(page, '/products', {
      name: 'Offline yogurt',
      sku: 'OFFLINE-YOG',
      category: 'Dairy',
      unit: 'piece',
      price: '70',
      cost: '59',
      taxRate: '0',
      minStock: '0',
      barcodes: ['709555'],
      plu: '101',
    })
  ).body;
  expect(product.id).toBeTruthy();
  expect(
    (
      await request(page, '/inventory/adjustments', {
        requestId: crypto.randomUUID(),
        productId: product.id,
        quantity: '3',
        reason: 'opening_balance',
      })
    ).status,
  ).toBe(201);
  const manualFile = join(dataDir, 'manual.elizabackup');
  await desktop.evaluate(({ Menu, dialog }, file) => {
    globalThis.__backupMessages = [];
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    dialog.showMessageBox = async (_window, options) => {
      globalThis.__backupMessages.push(options.message);
      return { response: 0 };
    };
    Menu.getApplicationMenu()
      .items[0].submenu.items.find((item) => item.label === 'Save store backup…')
      .click();
  }, manualFile);
  await expect
    .poll(() => desktop.evaluate(() => globalThis.__backupMessages.join(' ')), { timeout: 30000 })
    .toContain('Backup saved.');
  expect((await readArchive(manualFile)).manifest.tables.products).toBe('1');
  await desktop.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items[0].submenu.items.find((item) => item.label === 'Verify store backup…')
      .click(),
  );
  await expect
    .poll(() => desktop.evaluate(() => globalThis.__backupMessages.join(' ')), { timeout: 30000 })
    .toContain('temporary database and verified');
  const originalManual = await readFile(manualFile);
  await desktop.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items[0].submenu.items.find((item) => item.label === 'Save store backup…')
      .click(),
  );
  await expect
    .poll(() => desktop.evaluate(() => globalThis.__backupMessages.join(' ')), { timeout: 30000 })
    .toContain('Backup operation failed');
  expect(await readFile(manualFile)).toEqual(originalManual);
  expect((await request(page, '/pos/enroll', { name: 'Offline register' })).status).toBe(201);
  expect((await request(page, '/pos/login', { employeeCode: 'OWNER', pin: '654321' })).status).toBe(
    200,
  );
  const shift = (
    await request(page, '/pos/shifts', { requestId: crypto.randomUUID(), openingCash: '0' })
  ).body;
  const body = {
    requestId: crypto.randomUUID(),
    shiftId: shift.id,
    lines: [{ productId: product.id, quantity: '1', expectedPrice: '70.00', expectedTaxRate: '0' }],
    discountPercent: '0',
    payment: { method: 'cash', tendered: '100' },
  };
  const first = await request(page, '/pos/sales', body);
  expect(first.status).toBe(201);
  expect(first.body.total).toBe('70.00');
  const again = await request(page, '/pos/sales', body);
  expect(again.body.id).toBe(first.body.id);
  const catalog = (await request(page, '/pos/products')).body;
  expect(catalog.find((p) => p.id === product.id).stock).toBe('2.000');
  await page.evaluate(() => {
    window.__originalFetch = window.fetch;
    window.fetch = async () =>
      new Response(JSON.stringify({ user: { permissions: ['settings.manage'] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
  });
  await desktop.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items[0].submenu.items.find((item) => item.label === 'Save store backup…')
      .click(),
  );
  await expect
    .poll(() => desktop.evaluate(() => globalThis.__backupMessages.join(' ')))
    .toContain('Open Management');
  await page.evaluate(() => {
    window.fetch = window.__originalFetch;
    delete window.__originalFetch;
  });
  await page.goto('http://127.0.0.1:37931/pos');
  await expect(page.getByRole('heading', { name: 'Checkout', exact: true })).toBeVisible();
  await expect(page.getByText('Offline yogurt', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: '/private/tmp/eliza-desktop-offline.png' });
  await desktop.close();
  desktop = undefined;
  const backups = (await readdir(join(dataDir, 'backups')))
    .filter((name) => name.endsWith('.elizabackup'))
    .sort();
  expect(backups.length).toBeGreaterThanOrEqual(2);
  const backupFile = join(dataDir, 'backups', backups.at(-1));
  const archive = await readArchive(backupFile);
  expect(archive.manifest.reason).toBe('shutdown');
  expect(archive.manifest.tables.sales).toBe('1');
  const checking = await startDatabase({ root: resolve('.'), dataDir });
  try {
    expect(await needsMigration({ root: resolve('.'), url: checking.url })).toBe(false);
    const schemaView = join(dataDir, 'schema-view');
    await mkdir(join(schemaView, 'apps/api'), { recursive: true });
    await cp(resolve('apps/api/migrations'), join(schemaView, 'apps/api/migrations'), {
      recursive: true,
    });
    await symlink(resolve('apps/api/node_modules'), join(schemaView, 'apps/api/node_modules'));
    await writeFile(
      join(schemaView, 'apps/api/migrations/9999_backup_test.sql'),
      '-- pending upgrade fixture',
    );
    expect(await needsMigration({ root: schemaView, url: checking.url })).toBe(true);

    for (let i = 0; i < 50; i++)
      await writeFile(
        join(dataDir, 'backups', 'auto-2000-01-01-' + String(i).padStart(3, '0') + '.elizabackup'),
        'old fixture',
        { mode: 0o600 },
      );
    await automaticBackup({ root: resolve('.'), url: checking.url, dataDir });
    expect(
      (await readdir(join(dataDir, 'backups'))).filter(
        (n) => n.startsWith('auto-') && n.endsWith('.elizabackup'),
      ),
    ).toHaveLength(48);
    expect(await readFile(manualFile)).toEqual(originalManual);
    expect(
      (await verifyBackup({ root: resolve('.'), url: checking.url, file: backupFile })).sales,
    ).toBe('1');
  } finally {
    await checking.stop();
  }
  const corrupt = join(dataDir, 'corrupt.elizabackup');
  const bytes = await readFile(backupFile);
  bytes[bytes.length - 1] ^= 1;
  await writeFile(corrupt, bytes, { mode: 0o600 });
  await expect(readArchive(corrupt)).rejects.toThrow('checksum');
  const restoredDir = join(dataDir, 'restored-copy');
  await promisify(execFile)(
    process.execPath,
    [resolve('apps/desktop/scripts/restore-store.mjs'), backupFile, restoredDir],
    { timeout: 120000 },
  );
  await expect(
    promisify(execFile)(process.execPath, [
      resolve('apps/desktop/scripts/restore-store.mjs'),
      backupFile,
      dataDir,
    ]),
  ).rejects.toHaveProperty('code', 1);
  const restored = await startDatabase({ root: resolve('.'), dataDir: restoredDir, port: 54340 });
  const { Client } = createRequire(resolve('apps/api/package.json'))('pg');
  const restoredClient = new Client({ connectionString: restored.url });
  try {
    await restoredClient.connect();
    expect((await restoredClient.query('SELECT total FROM sales')).rows[0].total).toBe('70.00');
    expect(
      (await restoredClient.query('SELECT cost_total FROM sale_items')).rows[0].cost_total,
    ).toBe('59.00');
    expect(
      (await restoredClient.query('SELECT stock FROM products WHERE id=$1', [product.id])).rows[0]
        .stock,
    ).toBe('2.000');
    expect((await restoredClient.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n).toBe(
      0,
    );
    expect(
      (await restoredClient.query('SELECT count(*)::int AS n FROM pos_sessions')).rows[0].n,
    ).toBe(0);
  } finally {
    await restoredClient.end();
    await restored.stop();
  }
  page = await launch();
  // Device identity, PIN, shift, receipt and stock survive an actual runtime restart.
  expect((await request(page, '/pos/login', { employeeCode: 'OWNER', pin: '654321' })).status).toBe(
    200,
  );
  const recovered = await request(page, '/pos/sales', body);
  expect(recovered.body.id).toBe(first.body.id);
  expect((await request(page, '/pos/products')).body.find((p) => p.id === product.id).stock).toBe(
    '2.000',
  );
  expect((await request(page, '/pos/sales')).body.some((r) => r.id === first.body.id)).toBe(true);
  console.log(
    'PASS: offline sale, idempotency, restart, automatic backup, restore verification, corruption rejection and separate-store restoration.',
  );
} finally {
  await desktop?.close();
  await copyFile(join(dataDir, 'server.log'), '/private/tmp/eliza-desktop-last-server.log').catch(
    () => {},
  );
  await rm(dataDir, { recursive: true, force: true });
}
