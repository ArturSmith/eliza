import { test, expect } from './fixtures';

test('a paired phone scans into successive products, survives reloads and disconnects without management access', async ({
  page,
  browser,
}) => {
  test.setTimeout(100000);
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post('/api' + path, { headers, data });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  await post('/auth/setup', {
    storeName: 'Scanner shop',
    ownerName: 'Owner',
    email: 'phone-ui@local.test',
    password: 'test-password-12345',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  });
  await page.route('**/api/products/lookup/*', (r) => r.fulfill({ json: { suggestion: null } }));
  await page.goto('/products/new');
  await page.getByLabel('Product name', { exact: true }).fill('Phone bread');
  await page.getByLabel('Category', { exact: true }).fill('Bakery');
  await page.getByLabel('Unit', { exact: true }).selectOption('piece');
  let pairs = 0;
  page.on('response', (r) => {
    if (r.url().endsWith('/api/scanner-links') && r.request().method() === 'POST') pairs++;
  });
  const connection = page.waitForResponse(
    (r) => r.url().endsWith('/api/scanner-links') && r.request().method() === 'POST',
  );
  await page
    .locator('.product-lookup-panel')
    .getByRole('button', { name: 'Connect phone', exact: true })
    .click();
  const link = await (await connection).json();
  await expect(page.locator('.phone-pairing-qr svg')).toBeVisible();
  await page.screenshot({ path: '/private/tmp/eliza-phone-pairing.png', fullPage: true });
  const mobile = await browser.newContext({
    baseURL: 'http://localhost:5174',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phone = await mobile.newPage();
  // Keep the real Web Audio implementation: observe actual tones after mobile gesture unlock.
  await phone.addInitScript(() => {
    (window as any).__scanTones = [];
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const tone = create.call(this);
      const start = tone.start.bind(tone);
      tone.start = (when) => {
        (window as any).__scanTones.push({ frequency: tone.frequency.value, type: tone.type });
        start(when);
      };
      return tone;
    };
  });
  // The camera decoder is replaced only in this test; its real component callback is exercised.
  await phone.route('**/*zxing*', (r) =>
    r.fulfill({
      contentType: 'application/javascript',
      body: `export class BrowserMultiFormatReader {async decodeFromConstraints(_constraints,_video,callback){window.__scannerCallback=code=>callback({getText:()=>code});return {stop(){delete window.__scannerCallback;}};}}`,
    }),
  );
  const readyResponse = phone.waitForResponse(
    async (r) => r.url().endsWith('/api/scanner-phone/status') && r.ok() && (await r.json()).ready,
  );
  try {
    await phone.goto('/phone-scanner#pair=' + link.pairingToken);
    const firstTarget = (await (await readyResponse).json()).targetId;
    await expect(phone.getByText('Ready to scan', { exact: true })).toBeVisible();
    await expect(phone).toHaveURL('/phone-scanner');
    await phone.getByRole('button', { name: 'Enable scanner sound', exact: true }).click();
    await expect(
      phone.getByRole('button', { name: 'Enable scanner sound', exact: true }),
    ).toHaveCount(0);
    expect(await phone.evaluate(() => (window as any).__scanTones)).toHaveLength(0);
    expect((await phone.request.get('/api/products')).status()).toBe(401);
    await phone.waitForFunction(() => typeof (window as any).__scannerCallback === 'function');
    await phone.screenshot({ path: '/private/tmp/eliza-phone-scanner-mobile.png', fullPage: true });
    let sent = 0;
    phone.on('request', (r) => {
      if (r.url().endsWith('/api/scanner-phone/scans')) sent++;
    });
    await phone.evaluate(() => {
      (window as any).__scannerCallback('3017620422003');
      (window as any).__scannerCallback('3017620422003');
    });
    await expect(page.getByLabel('Scan or enter barcode')).toHaveValue('3017620422003');
    await expect(phone.getByText('Received on laptop', { exact: true })).toBeVisible();
    expect(sent).toBe(1);
    await expect
      .poll(() => phone.evaluate(() => (window as any).__scanTones))
      .toEqual([{ frequency: 1200, type: 'square' }]);
    await phone.evaluate(() => (window as any).__scannerCallback('3017620422003'));
    expect(await phone.evaluate(() => (window as any).__scanTones)).toHaveLength(1);
    const scanInto = async (label: string, value: string) => {
      await page.getByLabel(label, { exact: true }).focus();
      await expect(phone.locator('.phone-mobile-status')).toContainText('Selected field: ' + label);
      await phone.evaluate((code) => (window as any).__scannerCallback(code), value);
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
      await expect(phone.getByText('Received on laptop', { exact: true })).toBeVisible();
      await expect(phone.locator('.phone-last-scan strong')).toHaveText(value);
    };
    await scanInto('Product name', 'Scanned bread');
    await scanInto('Brand (optional)', 'Scanned brand');
    const description = 'Scanned QR description\n' + 'a'.repeat(250);
    await scanInto('Description (optional)', description);
    // A barcode field appends and deduplicates, while normal fields replace their text.
    await page.getByLabel('Barcodes (optional)', { exact: true }).focus();
    await expect(phone.locator('.phone-mobile-status')).toContainText(
      'Selected field: Barcodes (optional)',
    );
    await phone.evaluate(() => (window as any).__scannerCallback('12345678'));
    await expect(page.getByLabel('Barcodes (optional)', { exact: true })).toHaveValue(
      '3017620422003\n12345678',
    );
    await expect(phone.getByText('Received on laptop', { exact: true })).toBeVisible();
    // Oversized values are rejected rather than truncating a field or leaving a scan pending.
    await page.getByLabel('Brand (optional)', { exact: true }).focus();
    await expect(phone.locator('.phone-mobile-status')).toContainText(
      'Selected field: Brand (optional)',
    );
    const tonesBeforeRejection = await phone.evaluate(() => (window as any).__scanTones.length);
    await phone.evaluate(() => (window as any).__scannerCallback('x'.repeat(121)));
    await expect(
      phone.getByText('Scan not inserted. Select a field and scan again.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Brand (optional)', { exact: true })).toHaveValue('Scanned brand');
    expect(await phone.evaluate(() => (window as any).__scanTones.length)).toBe(
      tonesBeforeRejection,
    );
    // The same QR may populate a different selected field without reconnecting.
    await scanInto('Product name', 'Scanned brand');
    await scanInto('Product name', 'Scanned bread');
    // Camera and phone controls remain on the same line as the input, including mobile widths.
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const row = page.locator('.product-lookup-panel .scan-input-row');
      const input = await row.locator('input').boundingBox();
      const camera = await row.getByRole('button', { name: 'Scan with camera' }).boundingBox();
      const phoneButton = await row
        .getByRole('button', { name: 'Phone connected', exact: true })
        .boundingBox();
      expect(Math.abs(input!.y + input!.height / 2 - camera!.y - camera!.height / 2)).toBeLessThan(
        2,
      );
      expect(Math.abs(camera!.y - phoneButton!.y)).toBeLessThan(2);
      expect(phoneButton!.x - camera!.x - camera!.width).toBeGreaterThanOrEqual(6);
      await page.screenshot({
        path: '/private/tmp/eliza-scan-fields-' + width + '.png',
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    await expect(page.getByRole('dialog')).toHaveCount(0);
    const nextReady = phone.waitForResponse(
      async (r) =>
        r.url().endsWith('/api/scanner-phone/status') &&
        r.ok() &&
        (await r.json()).ready &&
        (await r.json()).targetId !== firstTarget,
    );
    await page.getByRole('button', { name: 'Add product', exact: true }).click();
    await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('');
    await nextReady;
    await expect(
      page.getByRole('button', { name: 'Phone connected', exact: true }).first(),
    ).toBeVisible();
    await page.getByLabel('Product name', { exact: true }).fill('Phone milk');
    await page.getByLabel('Category', { exact: true }).fill('Dairy');
    await page.getByLabel('Unit', { exact: true }).selectOption('piece');
    await page.getByLabel('Scan or enter barcode').focus();
    await expect(phone.locator('.phone-mobile-status')).toContainText(
      'Selected field: Scan or enter barcode',
    );
    await phone.evaluate(() => (window as any).__scannerCallback('5901234123457'));
    await expect(page.getByLabel('Scan or enter barcode')).toHaveValue('5901234123457');
    await expect(phone.locator('.phone-last-scan')).toContainText('5901234123457');
    await expect(phone.getByText('Received on laptop', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add product', exact: true }).click();
    await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('');
    const products = await (await page.request.get('/api/products')).json();
    const bread = products.find((p: any) => p.name === 'Scanned bread');
    expect(bread.barcodes).toContain('3017620422003');
    expect(bread.barcodes).toContain('12345678');
    expect(bread.brand).toBe('Scanned brand');
    expect(bread.description).toBe(description);
    expect(products.find((p: any) => p.name === 'Phone milk').barcodes).toContain('5901234123457');
    expect(pairs).toBe(1);
    await phone.reload();
    await expect(phone.getByText('Ready to scan', { exact: true })).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Phone connected', exact: true }).first(),
    ).toBeVisible();
    expect(pairs).toBe(1);
    await page.getByLabel('Product name', { exact: true }).fill('Phone cola');
    await page.getByLabel('Category', { exact: true }).fill('Drinks');
    await page.getByLabel('Unit', { exact: true }).selectOption('piece');
    await page.getByLabel('Volume / size (optional)', { exact: true }).fill('330');
    await page.getByLabel('Size unit', { exact: true }).selectOption('ml');
    const variantReady = phone.waitForResponse(
      async (r) =>
        r.url().endsWith('/api/scanner-phone/status') &&
        r.ok() &&
        (await r.json()).ready &&
        (await r.json()).label === 'Barcode 1',
    );
    await page.getByRole('button', { name: 'Add volume variant', exact: true }).click();
    await page.getByLabel('Volume 2', { exact: true }).fill('500');
    await page.getByLabel('Size unit 2', { exact: true }).selectOption('ml');
    await page.getByLabel('Barcode 1', { exact: true }).focus();
    await variantReady;
    await phone.evaluate(() => (window as any).__scannerCallback('5901234123464'));
    await expect(page.getByLabel('Barcode 1', { exact: true })).toHaveValue('5901234123464');
    const variantTwoReady = phone.waitForResponse(
      async (r) =>
        r.url().endsWith('/api/scanner-phone/status') &&
        r.ok() &&
        (await r.json()).ready &&
        (await r.json()).label === 'Barcode 2',
    );
    await page.getByLabel('Barcode 2', { exact: true }).focus();
    await variantTwoReady;
    await phone.evaluate(() => (window as any).__scannerCallback('5901234123471'));
    await expect(page.getByLabel('Barcode 2', { exact: true })).toHaveValue('5901234123471');
    await page.getByRole('button', { name: 'Create 2 products', exact: true }).click();
    await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('');
    expect(pairs).toBe(1);

    await page.goto('/products/' + bread.id);
    await page.getByLabel('Product name', { exact: true }).focus();
    await expect(phone.getByText('Waiting for the laptop', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Edit product', exact: true }).click();
    await scanInto('Product name', 'Edited scanned bread');
    await page.locator('.product-additional-information > summary').click();
    await page.getByLabel('SKU', { exact: true }).focus();
    await expect(phone.locator('.phone-mobile-status')).toContainText('Selected field: SKU');
    await page.locator('.product-additional-information > summary').click();
    await expect(phone.getByText('Waiting for the laptop', { exact: true })).toBeVisible();
    const barcodeField = page.getByLabel('Barcodes (optional)', { exact: true });
    await barcodeField.focus();
    await expect(phone.locator('.phone-mobile-status')).toContainText(
      'Selected field: Barcodes (optional)',
    );
    await phone.evaluate(() => (window as any).__scannerCallback('87654321'));
    await expect(barcodeField).toHaveValue('3017620422003\n12345678\n87654321');
    await expect(phone.getByText('Received on laptop', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit product', exact: true })).toBeVisible();
    const updated = await (await page.request.get('/api/products')).json();
    expect(updated.find((p: any) => p.id === bread.id)).toMatchObject({
      name: 'Edited scanned bread',
      barcodes: expect.arrayContaining(['87654321']),
    });
    await page.getByRole('button', { name: 'Phone connected', exact: true }).first().click();
    await page.getByRole('button', { name: 'Disconnect phone', exact: true }).click();
    await expect(phone.getByText('Scanner connection ended', { exact: true })).toBeVisible();
    await expect(page.locator('.phone-scanner-header')).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit product', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Connect phone', exact: true }).first(),
    ).toBeVisible();
  } finally {
    await mobile.close();
  }
});
