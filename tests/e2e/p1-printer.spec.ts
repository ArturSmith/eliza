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
    name: 'Йогурт — натуральный с клубникой, без добавленного сахара, семейная упаковка 500 граммов',
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/price-tags');
  const nav = page.getByRole('tablist', { name: 'Price Tags navigation' });
  await nav.getByRole('tab', { name: 'Layout', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Label layout', exact: true });
  await expect(editor.locator('.tag-layout-artwork canvas')).toHaveJSProperty('width', 400);
  await expect(editor.getByRole('alert')).toHaveCount(0);
  const nameObject = editor.getByRole('button', { name: 'Move Product name', exact: true });
  const nameBox = (await nameObject.boundingBox())!;
  await page.mouse.move(nameBox.x + nameBox.width / 2, nameBox.y + nameBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(nameBox.x + nameBox.width / 2 + 10, nameBox.y + nameBox.height / 2 + 12, {
    steps: 4,
  });
  await page.mouse.up();
  expect(Number(await editor.getByLabel('Horizontal position (mm)').inputValue())).toBeGreaterThan(
    2,
  );
  expect(Number(await editor.getByLabel('Vertical position (mm)').inputValue())).toBeGreaterThan(
    5.5,
  );
  await nameObject.focus();
  await page.keyboard.press('ArrowDown');
  await editor.getByLabel('Label orientation').selectOption('landscape');
  await expect(editor.locator('.tag-layout-artwork canvas')).toHaveJSProperty('width', 480);
  await expect(editor.locator('.tag-layout-artwork canvas')).toHaveJSProperty('height', 400);
  await editor.getByRole('button', { name: 'Reset positions' }).click();
  await editor.getByLabel('Selected object').selectOption('price');
  await editor.getByLabel('Horizontal position (mm)').fill('3');
  await editor.getByLabel('Vertical position (mm)').fill('14');
  await expect(editor.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: '/private/tmp/eliza-tag-layout-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/private/tmp/eliza-tag-layout-mobile.png' });
  await editor.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('Layout saved on this device.');
  await nav.getByRole('tab', { name: 'Products', exact: true }).click();
  await page.reload();
  await nav.getByRole('tab', { name: 'Layout', exact: true }).click();
  await expect(editor.getByLabel('Label orientation')).toHaveValue('landscape');
  await editor.getByLabel('Selected object').selectOption('price');
  await expect(editor.getByLabel('Horizontal position (mm)')).toHaveValue('3');
  await nav.getByRole('tab', { name: 'Printer', exact: true }).click();
  const dialog = page.getByRole('region', { name: 'Label printer' });
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
  await nav.getByRole('tab', { name: 'Products', exact: true }).click();
  const row = page.locator('.price-tags-product-entry', { hasText: 'Йогурт' });
  await row.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /Print selected tags/ }).click();
  const confirmation = page.getByRole('region', { name: 'Confirm label printing' });
  await expect(confirmation).toBeVisible({ timeout: 20000 });
  expect(complete).toBe(0);
  expect(await page.evaluate(() => (window as any).__printer.browserPrinted)).toBe(false);
  const sent = await page.evaluate(() => (window as any).__printer.bytes as number[]);
  expect(new TextDecoder().decode(Uint8Array.from(sent.slice(0, 38)))).toContain('GAP 3 mm');
  expect(sent.length).toBeLessThan(24000); // Arbitrary layouts can occupy more of the paper.
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
  await expect(page.getByRole('button', { name: 'Printer status' })).toHaveAttribute(
    'title',
    'Not connected',
  );
  await expect(page.getByRole('button', { name: /Print selected tags/ })).toBeDisabled();
  await nav.getByRole('tab', { name: 'Printer', exact: true }).click();
  await dialog.getByLabel('Print using').selectOption('browser');
  await nav.getByRole('tab', { name: 'Products', exact: true }).click();
  await page.getByRole('tab', { name: 'All products', exact: true }).click();
  await row.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /Print selected tags/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__printer.browserPrinted)).toBe(true);
  await expect(page.locator('.price-tag-custom img')).toHaveJSProperty('naturalWidth', 400);
  await expect(page.locator('.price-tag-custom img')).toHaveJSProperty('naturalHeight', 480);
  // Rotation must preserve every black/white pixel without interpolation.
  const pixelExact = await page.evaluate(async () => {
    const { renderLabel, renderLayoutView } = await import('/src/printing/label-image.ts');
    const savedKey = Object.keys(localStorage).find((key) => key.startsWith('eliza:tag-layout:'))!;
    const layout = JSON.parse(localStorage.getItem(savedKey)!);
    const content = {
      name: 'Йогурт',
      price: '60.00',
      barcode: '0400000000046',
      store: 'P1 labels',
    };
    const view = renderLayoutView(content, layout),
      paper = renderLabel(content, layout);
    const a = view.getContext('2d')!.getImageData(0, 0, 480, 400).data;
    const b = paper.getContext('2d')!.getImageData(0, 0, 400, 480).data;
    for (let y = 0; y < 400; y++)
      for (let x = 0; x < 480; x++)
        for (let c = 0; c < 4; c++) {
          if (a[(y * 480 + x) * 4 + c] !== b[((479 - x) * 400 + y) * 4 + c]) return false;
        }
    return true;
  });
  expect(pixelExact).toBe(true);
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 360, height: 640 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 568, height: 320 },
  ]) {
    await page.setViewportSize(viewport);
    for (const name of ['Products', 'Layout', 'Printer', 'More']) {
      await nav.getByRole('tab', { name, exact: true }).click();
      await expect(nav.getByRole('tab', { name, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
      const bottom = (await nav.boundingBox())!;
      expect(bottom.y + bottom.height).toBeLessThanOrEqual(viewport.height + 1);
      expect(bottom.y).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
        viewport.height + 1,
      );
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await nav.getByRole('tab', { name: 'Scanner', exact: true }).click();
  await expect(page.getByLabel('Camera preview')).toBeVisible();
  await page.locator('#price-tags-search').fill('0400000000046');
  await page.locator('#price-tags-search').press('Enter');
  await expect(row.locator('input[type="checkbox"]')).toBeChecked();
  await nav.getByRole('tab', { name: 'Products', exact: true }).click();
  await expect(page.getByLabel('Camera preview')).toHaveCount(0);
  await expect(row.locator('input[type="checkbox"]')).toBeChecked();
  await page.screenshot({ path: '/private/tmp/eliza-price-tags-mobile.png' });
  await nav.getByRole('tab', { name: 'Printer', exact: true }).click();
  await page.screenshot({ path: '/private/tmp/eliza-price-tags-printer-mobile.png' });
  await nav.getByRole('tab', { name: 'Layout', exact: true }).click();
  await page.screenshot({ path: '/private/tmp/eliza-price-tags-layout-mobile.png' });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => localStorage.setItem('eliza.language', 'ru'));
  await page.reload();
  const russianNav = page.getByRole('tablist', { name: 'Навигация по ценникам' });
  for (const name of ['Товары', 'Сканер', 'Макет', 'Принтер', 'Ещё']) {
    await russianNav.getByRole('tab', { name, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    const bottom = (await russianNav.boundingBox())!;
    expect(bottom.y + bottom.height).toBeLessThanOrEqual(569);
  }
  await russianNav.getByRole('tab', { name: 'Товары', exact: true }).click();
  await page.getByRole('tab', { name: 'Все товары', exact: true }).click();
  await page.screenshot({ path: '/private/tmp/eliza-price-tags-small-russian.png' });
});
