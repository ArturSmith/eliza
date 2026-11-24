import { test, expect } from './fixtures';

test('required fields and collapsed additional information preserve data across creation, editing and supplier creation', async ({
  page,
}) => {
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  async function post(path: string, data: unknown) {
    const r = await page.request.post('/api' + path, { headers, data });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  }
  await post('/auth/setup', {
    storeName: 'Product sections',
    ownerName: 'Owner',
    email: 'sections@local.test',
    password: 'test-password-12345',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  });
  await page.goto('/products/new');
  const additional = page.locator('.product-additional-information'),
    summary = additional.locator('summary');
  await expect(
    page.getByRole('heading', { name: 'Required information', exact: true }),
  ).toBeVisible();
  await expect(additional).not.toHaveAttribute('open');
  await expect(page.getByLabel('Brand (optional)', { exact: true })).toBeHidden();
  await expect(page.getByLabel('Selling price (optional)', { exact: true })).toBeHidden();
  await page.getByLabel('Product name', { exact: true }).fill('Basic bread');
  await page.getByLabel('Category', { exact: true }).fill('Bakery');
  await page.getByLabel('Unit', { exact: true }).selectOption('piece');
  const basicSaved = page.waitForResponse(
    (r) => r.url().endsWith('/api/products') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  const basicResponse = await basicSaved;
  expect(basicResponse.ok()).toBe(true);
  const basic = await basicResponse.json();
  expect(basic).toMatchObject({
    name: 'Basic bread',
    category: 'Bakery',
    unit: 'piece',
    price: null,
  });
  await expect(additional).not.toHaveAttribute('open');
  await summary.click();
  await page.getByLabel('Product name', { exact: true }).fill('Detailed bread');
  await page.getByLabel('Category', { exact: true }).fill('Bakery');
  await page.getByLabel('Unit', { exact: true }).selectOption('piece');
  await page.getByLabel('Brand (optional)', { exact: true }).fill('Local bakery');
  await page.getByLabel('Description (optional)', { exact: true }).fill('Fresh sourdough');
  await page.getByLabel('Selling price (optional)', { exact: true }).fill('45');
  await page.getByLabel('Tax rate (%)', { exact: true }).fill('15');
  await page.getByLabel('Low-stock threshold', { exact: true }).fill('10');
  await summary.click();
  await expect(additional).not.toHaveAttribute('open');
  const detailedSaved = page.waitForResponse(
    (r) => r.url().endsWith('/api/products') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  const detailed = await (await detailedSaved).json();
  expect(detailed).toMatchObject({
    brand: 'Local bakery',
    description: 'Fresh sourdough',
    price: '45.00',
    taxRate: '15.00',
    minStock: '10.000',
  });
  await expect(additional).not.toHaveAttribute('open');
  await page.goto('/products/' + detailed.id);
  await page.getByRole('button', { name: 'Edit product', exact: true }).click();
  await expect(additional).not.toHaveAttribute('open');
  await page.getByLabel('Product name', { exact: true }).fill('Renamed bread');
  const renamed = page.waitForResponse(
    (r) => r.url().endsWith('/api/products/' + detailed.id) && r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(await (await renamed).json()).toMatchObject({
    name: 'Renamed bread',
    brand: 'Local bakery',
    description: 'Fresh sourdough',
    price: '45.00',
    taxRate: '15.00',
    minStock: '10.000',
  });
  await page.getByRole('button', { name: 'Edit product', exact: true }).click();
  await expect(additional).not.toHaveAttribute('open');
  await summary.click();
  await page.getByLabel('Brand (optional)', { exact: true }).fill('Unsaved brand');
  await summary.click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Brand (optional)', { exact: true })).toHaveValue('Local bakery');
  await page.getByRole('button', { name: 'Edit product', exact: true }).click();
  await expect(additional).not.toHaveAttribute('open');
  const required = page.locator('.product-details-general');
  const first = await required.boundingBox(),
    second = await additional.boundingBox();
  expect(Math.abs(first!.width - second!.width)).toBeLessThanOrEqual(1);
  expect(second!.y).toBeGreaterThan(first!.y + first!.height);
  await page.screenshot({
    path: '/private/tmp/eliza-product-information-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: '/private/tmp/eliza-product-information-collapsed.png',
    fullPage: true,
  });
  await summary.click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: '/private/tmp/eliza-product-information-expanded.png',
    fullPage: true,
  });
  await page.goto('/products/new');
  await summary.click();
  await page.getByLabel('Product name', { exact: true }).fill('Invalid optional fields');
  await page.getByLabel('Category', { exact: true }).fill('Bakery');
  await page.getByLabel('Unit', { exact: true }).selectOption('piece');
  await page.getByLabel('Selling price (optional)', { exact: true }).fill('bad');
  await summary.click();
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  await expect(additional).toHaveAttribute('open');
  await expect(page.getByLabel('Selling price (optional)', { exact: true })).toBeVisible();
  await page.getByLabel('Selling price (optional)', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Add volume variant', exact: true }).click();
  await summary.click();
  await page.getByRole('button', { name: 'Create 2 products', exact: true }).click();
  await expect(additional).toHaveAttribute('open');
  await expect(page.getByLabel('Volume 1', { exact: true })).toBeVisible();
  const supplier = await post('/suppliers', {
    requestId: crypto.randomUUID(),
    code: 'SECTION',
    name: 'Bread supplier',
  });
  await page.goto('/suppliers/' + supplier.id + '/products/new');
  await page.getByRole('button', { name: 'Create new product', exact: true }).click();
  await expect(additional).not.toHaveAttribute('open');
  await expect(page.getByLabel('Product name', { exact: true })).toBeVisible();
  await page.getByLabel('Product name', { exact: true }).fill('Supplier bread');
  await page.getByLabel('Category', { exact: true }).fill('Bakery');
  await page.getByRole('button', { name: 'Create product', exact: true }).click();
  await expect(page).toHaveURL('/suppliers/' + supplier.id);
});
