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
    const state = {
      bytes: [] as number[],
      fail: false,
      browserPrinted: false,
      completionCalls: 0,
      discovery: 'success',
      options: null as unknown,
    };
    (window as any).__printer = state;
    window.print = () => {
      state.browserPrinted = true;
    };
    const device = Object.assign(new EventTarget(), {
      name: 'P1 BBS 7E',
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
      value: {
        requestDevice: async (options: unknown) => {
          state.options = options;
          if (state.discovery === 'cancel')
            throw new DOMException('No device selected', 'NotFoundError');
          if (state.discovery === 'blocked') throw new DOMException('Blocked', 'SecurityError');
          return device;
        },
      },
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
  await expect(dialog.getByLabel('Print speed')).toHaveValue('fast');
  await dialog.getByLabel('Print speed').selectOption('compatible');
  expect(await page.evaluate(() => localStorage.getItem('eliza:label-printer-speed'))).toBe(
    'compatible',
  );
  await dialog.getByLabel('Print speed').selectOption('fast');
  const connect = dialog.getByRole('button', { name: 'Connect printer', exact: true });
  await page.evaluate(() => {
    (window as any).__bluetooth = (navigator as any).bluetooth;
    Object.defineProperty(navigator, 'bluetooth', { value: undefined, configurable: true });
  });
  await connect.click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Bluetooth printing is unavailable in this browser',
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'bluetooth', {
      value: (window as any).__bluetooth,
      configurable: true,
    });
    (window as any).__printer.discovery = 'cancel';
  });
  await connect.click();
  await expect(dialog.getByText(/No printer selected/)).toBeVisible();
  await page.evaluate(() => {
    (window as any).__printer.discovery = 'blocked';
  });
  await connect.click();
  await expect(dialog.getByRole('alert')).toContainText('Bluetooth access was blocked');
  await page.evaluate(() => {
    (window as any).__printer.discovery = 'success';
  });
  await connect.click();
  await expect(dialog.getByText('Connected: P1 BBS 7E')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__printer.options)).toEqual({
    acceptAllDevices: true,
    optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb'],
  });
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
  expect(sent.length).toBeLessThan(12000);
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
