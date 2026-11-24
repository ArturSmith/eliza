import { test, expect } from './fixtures';

test('creates volume variants together, keeps an invalid draft, then resets for the next product', async ({
  page,
}) => {
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  const setup = await page.request.post('/api/auth/setup', {
    headers,
    data: {
      storeName: 'Volume shop',
      ownerName: 'Owner',
      email: 'volumes@example.test',
      password: 'test-password-12345',
      currency: 'NOK',
      timezone: 'Europe/Oslo',
    },
  });
  expect(setup.ok()).toBe(true);
  await page.goto('/products/new');
  await page.locator('.product-additional-information > summary').click();
  await page.getByLabel('Product name', { exact: true }).fill('Cola');
  await page.getByLabel('Brand (optional)', { exact: true }).fill('Brand Cola');
  await page.getByLabel('Category', { exact: true }).fill('Drinks');
  await page.getByLabel('Unit', { exact: true }).selectOption('piece');
  await page.getByLabel('Volume / size (optional)', { exact: true }).fill('330');
  await page.getByLabel('Size unit', { exact: true }).selectOption('ml');
  await page.getByLabel('Barcodes (optional)', { exact: true }).fill('5901234123457');
  await page.getByRole('button', { name: 'Add volume variant', exact: true }).click();
  await expect(page.getByLabel('Volume 1', { exact: true })).toHaveValue('330');
  await expect(page.getByLabel('Barcode 1', { exact: true })).toHaveValue('5901234123457');
  await page.getByLabel('Volume 2', { exact: true }).fill('500');
  await page.getByLabel('Size unit 2', { exact: true }).selectOption('ml');
  await page.getByLabel('Barcode 2', { exact: true }).fill('5901234123457');
  await page.getByRole('button', { name: 'Create 2 products', exact: true }).click();
  await expect(
    page.getByText('Each volume variant must have a unique barcode.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('Cola');
  await page.getByLabel('Barcode 2', { exact: true }).fill('5901234123464');
  await page.getByRole('button', { name: 'Add volume variant', exact: true }).click();
  await page.getByLabel('Volume 3', { exact: true }).fill('1');
  await page.getByLabel('Size unit 3', { exact: true }).selectOption('L');
  await page.getByLabel('Barcode 3', { exact: true }).fill('5901234123471');
  await page.getByRole('button', { name: 'Remove variant 3', exact: true }).click();
  await page.screenshot({ path: '/private/tmp/eliza-volume-form-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/private/tmp/eliza-volume-form-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/products/variants') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create 2 products', exact: true }).click();
  const response = await created;
  expect(response.ok()).toBe(true);
  const products = await response.json();
  await expect(page).toHaveURL('/products/new');
  await expect(
    page.getByText('Created 2 products. The form is ready for the next product.', { exact: false }),
  ).toBeVisible();
  for (const label of [
    'Product name',
    'Brand (optional)',
    'Volume / size (optional)',
    'Category',
    'Unit',
    'Barcodes (optional)',
  ])
    await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Product name', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Volume 1', { exact: true })).toHaveCount(0);
  await page.getByLabel('Product name', { exact: true }).fill('Next product');
  await page.getByLabel('Category', { exact: true }).fill('Drinks');
  await page.getByLabel('Unit', { exact: true }).selectOption('piece');
  const next = page.waitForResponse(
    (r) => r.url().endsWith('/api/products') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  expect((await next).ok()).toBe(true);
  await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('');
  await page.goto('/products');
  for (const product of products) {
    const card = page.getByRole('article', { name: 'Cola · ' + product.volume, exact: true });
    await expect(card).toContainText('Brand Cola');
    await expect(card).toContainText(product.barcodes[0]);
    await card.getByRole('link').click();
    await expect(page.getByLabel('Brand (optional)', { exact: true })).toHaveValue('Brand Cola');
    await expect(page.getByLabel('Volume / size (optional)', { exact: true })).toHaveValue(
      product.volume.split(' ')[0],
    );
    await page.goto('/products');
  }
});
