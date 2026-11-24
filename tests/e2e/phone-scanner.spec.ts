import { test, expect } from './fixtures';

test('a paired phone scans into successive products, survives reloads and disconnects without management access', async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
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
  await page.getByRole('button', { name: 'Connect phone', exact: true }).click();
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
    await phone.evaluate(() => (window as any).__scannerCallback('5901234123457'));
    await expect(page.getByLabel('Scan or enter barcode')).toHaveValue('5901234123457');
    await expect(phone.locator('.phone-last-scan')).toContainText('5901234123457');
    await expect(phone.getByText('Received on laptop', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add product', exact: true }).click();
    await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('');
    const products = await (await page.request.get('/api/products')).json();
    expect(products.find((p: any) => p.name === 'Phone bread').barcodes).toContain('3017620422003');
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
    await page.locator('.product-additional-information > summary').click();
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
    await page.getByRole('button', { name: 'Phone connected', exact: true }).first().click();
    await page.getByRole('button', { name: 'Disconnect phone', exact: true }).click();
    await expect(phone.getByText('Scanner connection ended', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect phone', exact: true })).toBeVisible();
  } finally {
    await mobile.close();
  }
});
