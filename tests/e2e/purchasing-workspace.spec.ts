import sharp from 'sharp';
import { test, expect } from './fixtures';

test('supplier cards, full-page ordering, delivery and payment keep the original inventory flow', async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  async function post(path: string, data: unknown) {
    const response = await page.request.post('/api' + path, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  await post('/auth/setup', {
    storeName: 'Purchasing shop',
    ownerName: 'Owner',
    email: 'purchasing@example.test',
    password: 'test-password-12345',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  });
  const image =
    'data:image/jpeg;base64,' +
    (
      await sharp({ create: { width: 80, height: 120, channels: 3, background: '#d7e6d4' } })
        .jpeg()
        .toBuffer()
    ).toString('base64');
  const product = await post('/products', {
    image,
    description: 'Plain yogurt from a local dairy.',
    name: 'Farm yogurt',
    sku: 'FARM-YOG',
    category: 'Dairy',
    unit: 'piece',
    price: '12',
    cost: '8',
    taxRate: '0',
    minStock: '1',
    barcodes: [],
  });
  await page.goto('/purchases');
  await expect(page.getByRole('link', { name: 'Suppliers & purchases', exact: true })).toHaveCount(
    1,
  );
  await expect(page.getByRole('link', { name: 'Suppliers', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Add supplier', exact: true }).first().click();
  await expect(page).toHaveURL('/suppliers/new');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Supplier name', { exact: true }).fill('Nordic Dairy');
  await page.getByRole('button', { name: 'Generate supplier code' }).click();
  await expect(page.getByLabel('Supplier code', { exact: true })).toHaveValue('SUP-00001');
  await page.getByLabel('Sales representative', { exact: true }).fill('Anna Hansen');
  await page.getByLabel('Representative phone', { exact: true }).fill('+4791112222');
  await page.getByLabel('WhatsApp number', { exact: true }).fill('+4791112222');
  await page.getByLabel('Email', { exact: true }).fill('orders@dairy.test');
  await page.getByLabel('Address', { exact: true }).fill('Oslo, Norway');
  await page.getByLabel('Payment terms', { exact: true }).fill('14 days');
  await page.getByLabel('Tags (optional)').fill('Dairy, Local');
  await page.getByRole('button', { name: 'Save supplier', exact: true }).click();
  await expect(page).toHaveURL(/\/suppliers\/[\da-f-]+$/);
  const supplierId = new URL(page.url()).pathname.split('/').pop()!;
  await expect(page.getByRole('heading', { name: 'Nordic Dairy', exact: true })).toBeVisible();
  await expect(page.locator('.supplier-profile-summary')).toContainText('Anna Hansen');
  await page.getByRole('link', { name: 'Add product', exact: true }).click();
  await expect(page).toHaveURL(`/suppliers/${supplierId}/products/new`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Price per pack')).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Find a product', exact: true }).fill('Farm yogurt');
  await page.getByRole('button', { name: 'Add Farm yogurt to supplier', exact: true }).click();
  await expect(page).toHaveURL(`/suppliers/${supplierId}`);
  await page
    .getByRole('article', { name: 'Farm yogurt', exact: true })
    .getByRole('link', { name: 'Edit supplier price', exact: true })
    .click();
  await page.getByLabel('Units per pack').fill('12');
  await page.getByLabel('Price per pack').fill('90');
  await page.getByLabel('Lead time in days').fill('2');
  await page.getByRole('button', { name: 'Save price', exact: true }).click();
  await expect(page).toHaveURL(`/suppliers/${supplierId}`);
  const yogurtCard = page.getByRole('article', { name: 'Farm yogurt', exact: true });
  await expect(yogurtCard).toBeVisible();
  await expect(yogurtCard.locator('img')).toHaveAttribute('src', image);
  await expect(yogurtCard).toContainText('Plain yogurt from a local dairy.');
  await expect(yogurtCard).toContainText('7.50');
  await expect(yogurtCard).toContainText('90.00');
  await yogurtCard.getByRole('link', { name: 'View Farm yogurt', exact: true }).click();
  await expect(page).toHaveURL(`/products/${product.id}`);
  await page.goBack();
  await yogurtCard.getByRole('link', { name: 'Edit supplier price', exact: true }).click();
  await expect(page.getByLabel('Units per pack')).toHaveValue('12');
  await expect(page.getByLabel('Price per pack')).toHaveValue('90.00');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  for (const name of ['Z Apples', 'Z Bread']) {
    const extra = await post('/products', {
      name,
      sku: name.replace(' ', '-'),
      category: 'Food',
      unit: 'piece',
      price: '12',
      cost: '8',
      taxRate: '0',
      minStock: '0',
      barcodes: [],
    });
    await post('/supplier-products', {
      requestId: crypto.randomUUID(),
      supplierId,
      productId: extra.id,
      packSize: '6',
      packCost: '42',
      leadTimeDays: 1,
    });
  }
  await page.reload();
  await expect(page.locator('.supplier-product-card')).toHaveCount(3);
  await expect(
    page
      .getByRole('article', { name: 'Z Apples', exact: true })
      .locator('.supplier-product-photo svg'),
  ).toBeVisible();
  const grid = await page
    .locator('.supplier-product-grid')
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(grid).toBeGreaterThanOrEqual(2);
  await page
    .locator('.supplier-products-panel')
    .screenshot({ path: test.info().outputPath('supplier-product-grid.png') });
  const other = await post('/suppliers', {
    requestId: crypto.randomUUID(),
    code: 'OTHER',
    name: 'Other supplier',
  });
  const otherOrder = await post('/purchases', {
    requestId: crypto.randomUUID(),
    supplierId: other.id,
    lines: [{ productId: product.id, quantity: '1', unitCost: '8', taxRate: '0' }],
  });
  await page.getByRole('link', { name: 'Create order', exact: true }).click();
  await expect(page).toHaveURL(`/suppliers/${supplierId}/order`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Select a supplier', exact: true })).toHaveCount(0);
  await page.getByLabel('Supplier reference').fill('DAIRY-001');
  await page.getByRole('button', { name: 'Select a product', exact: true }).click();
  await page.getByRole('option', { name: /Farm yogurt/ }).click();
  const row = page.getByRole('row', { name: 'Purchase row 1' });
  await expect(row.getByLabel('Unit cost excl. tax', { exact: true })).toHaveValue('7.50');
  await row.getByLabel('Quantity', { exact: true }).fill('4');
  await row.getByLabel('Purchase tax %', { exact: true }).fill('15');
  await page.getByLabel('Order notes', { exact: true }).fill('Deliver to the back door');
  // Check the actual wrapped Russian labels, not just English text at one width.
  const settings = await page.context().newPage();
  await settings.addLocatorHandler(
    settings.locator('[data-onboarding-dialog][open]'),
    async (dialog) => {
      await dialog.locator('.page-tour-skip').click();
    },
  );
  await settings.goto('/settings');
  await settings.getByLabel('Language', { exact: true }).selectOption('ru');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  let sawWrappedLabel = false;
  for (const width of [1536, 1280, 1100, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const input = box('.purchase-reference-row input');
      const generate = box('.purchase-reference-generate');
      const fields = [...document.querySelectorAll('.purchase-line-field')].flatMap((cell) => {
        const input = cell.querySelector('input');
        return input
          ? [
              {
                row: cell.getBoundingClientRect().top,
                top: input.getBoundingClientRect().top,
                height: input.getBoundingClientRect().height,
              },
            ]
          : [];
      });
      return {
        fits: document.documentElement.scrollWidth <= innerWidth,
        referenceAligned:
          generate.left >= input.right
            ? Math.abs(generate.bottom - input.bottom) <= 1
            : generate.top - input.bottom >= 12,
        controlsAligned: fields.every((field) =>
          fields.every(
            (other) => Math.abs(field.row - other.row) > 1 || Math.abs(field.top - other.top) <= 1,
          ),
        ),
        heightsMatch: fields.every((field) => Math.abs(field.height - fields[0].height) <= 1),
        footerGap: box('.purchase-draft-footer').top - box('.purchase-draft-scroll').bottom,
        wrappedLabel: [...document.querySelectorAll('.purchase-line-field')].some((cell) => {
          const label = getComputedStyle(cell, '::before');
          return parseFloat(label.height) > parseFloat(label.lineHeight) * 1.5;
        }),
      };
    });
    sawWrappedLabel ||= layout.wrappedLabel;
    expect(layout.fits, `No horizontal overflow at ${width}px`).toBe(true);
    expect(layout.referenceAligned, `Reference button at ${width}px`).toBe(true);
    expect(layout.controlsAligned, `Input baselines at ${width}px`).toBe(true);
    expect(layout.heightsMatch, `Input heights at ${width}px`).toBe(true);
    expect(layout.footerGap, `Space before totals at ${width}px`).toBeGreaterThanOrEqual(24);
    if (width === 1280 || width === 1100 || width === 390) {
      await page.screenshot({
        path: test.info().outputPath(`purchase-form-ru-${width}.png`),
        fullPage: true,
      });
    }
  }
  expect(sawWrappedLabel, 'Exercise labels that actually wrap onto multiple lines').toBe(true);
  await settings.getByLabel('Язык', { exact: true }).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await settings.close();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: test.info().outputPath('new-order-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page).toHaveURL(/\/purchases\/[\da-f-]+$/);
  const orderId = new URL(page.url()).pathname.split('/').pop()!;
  let order = await (await page.request.get('/api/purchases/' + orderId)).json();
  expect(order.total).toBe('34.50');
  expect(order.supplier_id).toBe(supplierId);
  expect(
    (await (await page.request.get('/api/products')).json()).find(
      (p: { id: string }) => p.id === product.id,
    ).stock,
  ).toBe('0.000');
  await page.getByRole('link', { name: 'Edit draft', exact: true }).click();
  await expect(page.getByLabel('Order notes', { exact: true })).toHaveValue(
    'Deliver to the back door',
  );
  await page.getByLabel('Order notes', { exact: true }).fill('Bring two deliveries');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Bring two deliveries', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Receive delivery', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Send via WhatsApp', exact: true }).click();
  await expect(page).toHaveURL(`/purchases/${orderId}/whatsapp`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.purchase-action-panel textarea')).toHaveValue(/Farm yogurt/);
  await page.getByRole('button', { name: 'Back to order', exact: true }).click();
  await page.getByRole('link', { name: 'Receive delivery', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Delivery reference (optional)').fill('DAIRY-DEL-1');
  await page.locator('.delivery-expiry-batch').getByLabel('Quantity', { exact: true }).fill('2');
  await page.locator('.delivery-price-confirmation input').check();
  await page.getByRole('button', { name: 'Record delivery', exact: true }).click();
  await expect(page).toHaveURL(`/purchases/${orderId}`);
  expect(
    (await (await page.request.get('/api/products')).json()).find(
      (p: { id: string }) => p.id === product.id,
    ).stock,
  ).toBe('2.000');
  await page.locator('.order-payment').getByRole('link', { name: 'Update payment' }).click();
  await page.getByLabel('Payment due date', { exact: true }).fill('2000-01-01');
  await page.getByRole('button', { name: 'Save payment status' }).click();
  await expect(page.locator('.order-payment')).toContainText('Overdue');
  await page.getByRole('link', { name: 'Close remaining quantities', exact: true }).click();
  await page.getByLabel('Closure reason').fill('Remaining quantity not available');
  await page.getByRole('button', { name: 'Confirm closure' }).click();
  await expect(page.getByText('Remaining quantities closed', { exact: true })).toBeVisible();
  order = await (await page.request.get('/api/purchases/' + orderId)).json();
  expect(order.status).toBe('closed');
  expect(order.payment_status).toBe('unpaid');
  expect(
    (await (await page.request.get('/api/products')).json()).find(
      (p: { id: string }) => p.id === product.id,
    ).stock,
  ).toBe('2.000');
  await page.getByRole('button', { name: 'Back to supplier', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Purchase history', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('cell', { name: otherOrder.number, exact: true })).toHaveCount(0);
  const history = await (
    await page.request.get(`/api/purchases?page=1&supplierId=${supplierId}`)
  ).json();
  expect(history.total).toBe(1);
  expect(history.rows[0].id).toBe(orderId);
  await expect(page.getByRole('cell', { name: /DAIRY-001/ })).toBeVisible();
  await page.getByRole('link', { name: 'Edit supplier', exact: true }).click();
  await page.getByLabel('Supplier phone', { exact: true }).fill('+4793334444');
  await page.getByRole('button', { name: 'Save supplier', exact: true }).click();
  await expect(page.locator('.supplier-profile-summary')).toContainText('+4793334444');
  await page.evaluate(() => localStorage.setItem('eliza.language', 'ru'));
  await page.reload();
  await page.screenshot({
    path: test.info().outputPath('supplier-details-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('supplier-details-mobile.png'),
    fullPage: true,
  });
  await page.goto('/purchases');
  await expect(page.locator('.supplier-directory-card')).toHaveCount(2);
  await page.screenshot({ path: test.info().outputPath('suppliers-mobile.png'), fullPage: true });
  await page.goto(`/suppliers/${supplierId}/order`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('new-order-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});
