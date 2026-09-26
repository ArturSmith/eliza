import { test, expect } from '@playwright/test';

test('prints selected weight labels and regular price tags together', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('Weight label shop');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Email address').fill('weight-label@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await expect(page.getByRole('link', { name: 'Shopping lists', exact: true })).toBeVisible();

  async function post(path: string, data: unknown) {
    const response = await page.request.post('/api' + path, {
      headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }

  await post('/products', {
    name: 'Apples by weight',
    sku: 'APPLES-WEIGHT',
    category: 'Fruit',
    unit: 'kilogram',
    price: '30',
    cost: '10',
    taxRate: '0',
    minStock: '0',
    barcodes: [],
    plu: '42',
  });
  const water = await post('/products', {
    name: 'Bottled water',
    sku: 'WATER-1',
    category: 'Drinks',
    unit: 'piece',
    price: '25',
    cost: '12',
    taxRate: '0',
    minStock: '0',
    barcodes: ['4601234567893'],
    plu: '',
  });
  const editedWater = await page.request.patch('/api/products/' + water.id, {
    headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
    data: { ...water, price: '26', barcodes: ['4601234567893'] },
  });
  expect(editedWater.ok(), await editedWater.text()).toBe(true);
  const profile = await (await page.request.get('/api/store-profile')).json();
  await post('/store-profile', {
    ...profile,
    scaleBarcode: { enabled: true, prefix: '20', productDigits: 5, mode: 'weight', decimals: 3 },
    tagDesign: { ...profile.tagDesign, weightWidthMm: 80, showStoreName: true },
  });
  const roles = await (await page.request.get('/api/team/roles')).json();
  await post('/team', {
    name: 'Sam',
    employeeCode: 'SAM',
    roleId: roles.find((role: { name: string }) => role.name === 'General employee').id,
    pin: '123456',
  });
  const session = await (await page.request.get('/api/auth/session')).json();
  const device = await page.request.patch('/api/devices/' + session.device.id, {
    headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
    data: { name: 'Label station', active: true, type: 'price_tags' },
  });
  expect(device.ok(), await device.text()).toBe(true);

  await page.goto('/price-tags');
  await page.getByLabel('Employee').selectOption('SAM');
  await page.getByLabel('PIN').fill('123456');
  await page.getByRole('button', { name: 'Unlock Price Tags' }).click();
  const changedTab = page.getByRole('tab', { name: /Price changed/ });
  await expect(changedTab).toHaveAttribute('aria-selected', 'true');
  await expect(changedTab).toContainText('1');
  await expect(page.locator('.price-tags-product-entry')).toHaveCount(1);
  await expect(page.locator('.price-tags-product-entry')).toContainText('Bottled water');
  await page.reload();
  await expect(changedTab).toContainText('1');
  await page.getByRole('tab', { name: 'All products', exact: true }).click();
  const weightedRow = page.locator('.price-tags-product-entry', { hasText: 'Apples by weight' });
  await weightedRow.locator('input[type="checkbox"]').check();
  await weightedRow.getByPlaceholder('Enter package weight').fill('0.532');
  const regularRow = page.locator('.price-tags-product-entry', { hasText: 'Bottled water' });
  await regularRow.locator('input[type="checkbox"]').check();
  await expect(page.getByRole('button', { name: /Print selected tags/ })).toContainText('(2)');
  await expect(page.getByRole('button', { name: /Print selected tags/ })).toBeEnabled();
  await page.evaluate(() => {
    window.print = () => {
      document.body.dataset.printed = 'yes';
    };
  });
  await page.getByRole('button', { name: /Print selected tags/ }).click();
  await expect(page.locator('body')).toHaveAttribute('data-printed', 'yes');
  const printedTag = page.locator('.price-tags-print-sheet .price-tag-weight');
  await expect(printedTag).toHaveCSS('width', /302\.3/);
  await expect(printedTag).toContainText('Weight label shop');
  await expect(printedTag).toContainText('0.532');
  await expect(printedTag).toContainText('30');
  await expect(printedTag).toContainText('15.96');
  await expect(printedTag.locator('.weight-barcode-image')).toHaveCount(1);
  await expect(
    page.locator('.price-tags-print-sheet .price-tag:not(.price-tag-weight)'),
  ).toContainText('Bottled water');
  await expect(page.locator('.price-tags-print-sheet .price-tag')).toHaveCount(2);
  await expect(changedTab).toContainText('0');
  await changedTab.click();
  await expect(page.locator('.price-tags-product-entry')).toHaveCount(0);
  await expect(page.getByText('No price changes waiting for tags.')).toBeVisible();
  await page.reload();
  await expect(changedTab).toContainText('0');
  await page.getByRole('tab', { name: 'All products', exact: true }).click();
  await expect(page.locator('.price-tags-product-entry')).toHaveCount(2);
});
