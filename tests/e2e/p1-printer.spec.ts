import { test, expect } from './fixtures';

test('P1 printing uses local controls and only completes price changes after physical-print confirmation', async ({
  page,
}) => {
  test.setTimeout(60000);
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  async function request(path: string, data: unknown, method = 'POST') {
    const response = await page.request.fetch('/api' + path, { method, headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  await request('/auth/setup', {
    storeName: 'P1 labels',
    ownerName: 'Manager',
    email: 'p1@example.test',
    password: 'local-password-12345',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  });
  const product = await request('/products', {
    name: 'Йогурт — натуральный',
    sku: 'YOG',
    category: 'Dairy',
    unit: 'piece',
    price: '70',
    cost: '59',
    taxRate: '0',
    minStock: '0',
    barcodes: ['0400000000046'],
    plu: '',
  });
  await request(
    '/products/' + product.id,
    { ...product, price: '60', barcodes: ['0400000000046'] },
    'PATCH',
  );
  const roles = await (await page.request.get('/api/team/roles')).json();
  await request('/team', {
    name: 'Label employee',
    employeeCode: 'LABEL',
    pin: '123456',
    roleId: roles.find((role: { name: string }) => role.name === 'General employee').id,
  });
  const session = await (await page.request.get('/api/auth/session')).json();
  await request(
    '/devices/' + session.device.id,
    { name: 'Android label station', type: 'price_tags', active: true },
    'PATCH',
  );
  await request('/price-tags/login', { employeeCode: 'LABEL', pin: '123456' });
  await page.addInitScript(() => {
    const originalTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      originalTimeout(handler, timeout === 30 ? 0 : timeout, ...args)) as typeof window.setTimeout;
    const state = { bytes: [] as number[], fail: false, browserPrinted: false, completionCalls: 0 };
    (window as any).__printer = state;
    window.print = () => {
      state.browserPrinted = true;
    };
    const device = Object.assign(new EventTarget(), {
      name: 'P1_TEST',
      gatt: {
        connected: false,
        async connect() {
          this.connected = true;
          return {
            getPrimaryService: async () => ({
              getCharacteristic: async () => ({
                properties: { write: false, writeWithoutResponse: true },
                async writeValueWithoutResponse(value: Uint8Array) {
                  if (state.fail) throw new Error('Disconnected');
                  state.bytes.push(...value);
                },
              }),
            }),
          };
        },
        disconnect() {
          this.connected = false;
          device.dispatchEvent(new Event('gattserverdisconnected'));
        },
      },
    });
    Object.defineProperty(navigator, 'bluetooth', {
      value: { requestDevice: async () => device },
      configurable: true,
    });
  });
  let complete = 0;
  page.on('request', (request) => {
    if (/\/price-tags\/prints\/[^/]+\/complete$/.test(request.url())) complete++;
  });
  await page.goto('/price-tags');
  await page.getByRole('button', { name: /^Printer:/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Label printer' });
  await dialog.getByLabel('Print using').selectOption('p1');
  await expect(dialog.locator('canvas')).toHaveJSProperty('width', 400);
  await expect(dialog.locator('canvas')).toHaveJSProperty('height', 480);
  await dialog.getByLabel('Gap between labels (mm)').fill('3');
  await dialog.getByRole('button', { name: 'Connect printer', exact: true }).click();
  await expect(dialog.getByText('Connected: P1_TEST')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/private/tmp/eliza-p1-printer-mobile.png' });
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  const row = page.locator('.price-tags-product-entry', { hasText: 'Йогурт' });
  await row.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /Print selected tags/ }).click();
  const confirmation = page.getByRole('region', { name: 'Confirm label printing' });
  await expect(confirmation).toBeVisible({ timeout: 20000 });
  expect(complete).toBe(0);
  expect(await page.evaluate(() => (window as any).__printer.browserPrinted)).toBe(false);
  const sent = await page.evaluate(() => (window as any).__printer.bytes as number[]);
  expect(new TextDecoder().decode(Uint8Array.from(sent.slice(0, 38)))).toContain('GAP 3 mm');
  await page.getByRole('button', { name: 'All labels printed correctly' }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(row).toHaveCount(0);
  expect(complete).toBe(1);
  await page.getByRole('tab', { name: 'All products', exact: true }).click();
  await row.locator('input[type="checkbox"]').check();
  await page.evaluate(() => {
    (window as any).__printer.fail = true;
  });
  await page.getByRole('button', { name: /Print selected tags/ }).click();
  await expect(page.getByRole('alert')).toContainText('Printing was interrupted');
  expect(complete).toBe(1);
  await expect(confirmation).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /^Printer: Not connected/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Print selected tags/ })).toBeDisabled();
});
