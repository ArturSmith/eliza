import { test, expect } from './fixtures';
test('receives one product with multiple expiry dates and preserves batch quantities', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('Payment shop');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Email address').fill('payments@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await expect(page.getByRole('link', { name: 'Purchases', exact: true })).toBeVisible();
  async function post(path: string, data: unknown) {
    const r = await page.request.post('/api' + path, {
      headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
      data,
    });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  }
  const supplier = await post('/suppliers', {
    requestId: crypto.randomUUID(),
    code: 'PAY',
    name: 'Supplier',
  });
  const product = await post('/products', {
    name: 'Milk',
    sku: 'PAY-MILK',
    category: 'Dairy',
    unit: 'piece',
    price: '10',
    cost: '5',
    taxRate: '0',
    minStock: '0',
    barcodes: [],
  });
  let order = await post('/purchases', {
    requestId: crypto.randomUUID(),
    supplierId: supplier.id,
    lines: [{ productId: product.id, quantity: '10', unitCost: '5', taxRate: '0' }],
  });
  order = await post('/purchases/' + order.id + '/status', {
    requestId: crypto.randomUUID(),
    version: order.version,
    status: 'ordered',
  });
  await page.goto('/purchases');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Receive delivery', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Receive delivery', exact: true });
  const batches = dialog.locator('.delivery-expiry-batch');
  await batches.nth(0).getByLabel('Quantity', { exact: true }).fill('5');
  await batches.nth(0).getByLabel('Expiry date (optional)').fill('2035-01-01');
  await dialog.getByRole('button', { name: 'Add expiry batch', exact: true }).click();
  await batches.nth(1).getByLabel('Quantity', { exact: true }).fill('5');
  await batches.nth(1).getByLabel('Expiry date (optional)').fill('2036-01-01');
  await expect(dialog.getByText('Total received: 10.000 piece')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add expiry batch', exact: true }).click();
  await dialog.getByRole('button', { name: 'Record delivery', exact: true }).click();
  await expect(
    dialog.getByText('Enter a positive quantity for every expiry batch, or remove unused batches.'),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove expiry batch 3', exact: true }).click();
  await page.screenshot({ path: 'test-results/expiry-batches-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/expiry-batches-mobile.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Record delivery', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const inventory = await (
    await page.request.get('/api/inventory/products/' + product.id + '/batches')
  ).json();
  expect(inventory.product.stock).toBe('10.000');
  expect(inventory.batches).toMatchObject([
    { quantity: '5.000', expiryDate: '2035-01-01', unitCost: '5.00' },
    { quantity: '5.000', expiryDate: '2036-01-01', unitCost: '5.00' },
  ]);
  await page.reload();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.locator('.delivery-entry summary').first().click();
  await expect(page.locator('.delivery-expiry-history')).toContainText('2035-01-01');
  await expect(page.locator('.delivery-expiry-history')).toContainText('2036-01-01');
  await page.goto('/inventory');
  await expect(page.locator('.stock-batch-row')).toHaveCount(2);
  await expect(page.locator('.stock-batch-row').first()).toContainText('Purchase cost');
  await page.screenshot({ path: 'test-results/batch-costs-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.stock-batch-row').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/batch-costs-mobile.png', fullPage: true });
});
