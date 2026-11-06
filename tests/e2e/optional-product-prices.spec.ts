import { test, expect } from './fixtures';

test('creates and reopens a product with unknown prices, then saves real prices', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Store name').fill('Optional prices shop');
  await page.getByLabel('Your name').fill('Owner');
  await page.getByLabel('Email address').fill('optional-prices@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await page.getByRole('link', { name: 'Add product' }).first().click();
  const form = page.locator('.product-details-page');
  await form.getByLabel('Product name').fill('Unpriced yogurt');
  await form.getByLabel('SKU', { exact: true }).fill('UNKNOWN-YOG');
  await form.getByLabel('Category', { exact: true }).fill('Dairy');
  await form.getByLabel('Unit', { exact: true }).selectOption('piece');
  await expect(form.getByLabel('Purchase cost (optional)', { exact: true })).toHaveCount(0);
  await expect(form.getByLabel('Selling price (optional)', { exact: true })).toHaveValue('');
  await form.getByRole('button', { name: 'Add product', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit product', exact: true })).toBeVisible();
  const products = await (await page.request.get('/api/products')).json();
  const product = products.find((p: any) => p.sku === 'UNKNOWN-YOG');
  expect(product).toMatchObject({ price: null, cost: null });
  await page.reload();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit product', exact: true }).click();
  await expect(page.getByLabel('Selling price (optional)', { exact: true })).toHaveValue('');
  await page.getByLabel('Selling price (optional)', { exact: true }).fill('70');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/products\/[^/]+$/);
  await expect(page.getByRole('button', { name: 'Edit product', exact: true })).toBeVisible();
  const saved = (await (await page.request.get('/api/products')).json()).find(
    (p: any) => p.id === product.id,
  );
  expect(saved).toMatchObject({ price: '70.00', cost: null });
  await page.getByRole('button', { name: 'Record stock', exact: true }).click();
  const stockForm = page.getByRole('region', { name: 'Record stock', exact: true });
  await stockForm.getByLabel('Quantity change', { exact: true }).fill('5');
  await stockForm.getByLabel('Reason', { exact: true }).selectOption('opening_balance');
  await stockForm.getByLabel('Cost is unknown', { exact: true }).check();
  await expect(stockForm.getByLabel('Cost per unit for this stock')).toHaveCount(0);
  await stockForm.getByRole('button', { name: 'Record adjustment', exact: true }).click();
  await expect(stockForm).not.toBeVisible();
  await expect(page.getByText('Cost is unknown for 5 units.', { exact: false })).toBeVisible();
  await expect(page.locator('.product-batch-costs')).toContainText('Cost is unknown');
  const current = (await (await page.request.get('/api/products')).json()).find(
    (p: any) => p.id === product.id,
  );
  expect(current).toMatchObject({
    stockValue: null,
    averageCost: null,
    unknownCostQuantity: '5.000',
  });
  const batchesCard = page.getByRole('region', { name: 'Stock batches', exact: true });
  await expect(batchesCard.getByRole('button', { name: /Show all/ })).toHaveCount(0);
  const supplierResponse = await page.request.post('/api/suppliers', {
    headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
    data: { requestId: crypto.randomUUID(), code: 'BATCH-SUP', name: 'Batch supplier' },
  });
  expect(supplierResponse.ok()).toBe(true);
  const supplier = await supplierResponse.json();
  for (const unitCost of ['2', '3']) {
    const response = await page.request.post('/api/inventory/adjustments', {
      headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
      data: {
        requestId: crypto.randomUUID(),
        productId: product.id,
        quantity: '1',
        reason: 'received',
        supplierId: supplier.id,
        unitCost,
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
  await page.reload();
  const batchRows = batchesCard.getByRole('article');
  await expect(batchRows).toHaveCount(2);
  await expect(batchRows.nth(0)).toContainText('3.00');
  await expect(batchRows.nth(1)).toContainText('2.00');
  await expect(batchRows.nth(0)).not.toContainText('Cost is unknown');
  await expect(batchRows.nth(1)).not.toContainText('Cost is unknown');
  await expect(
    batchRows.nth(0).getByRole('link', { name: 'Batch supplier', exact: true }),
  ).toHaveAttribute('href', `/suppliers/${supplier.id}`);
  await expect(batchRows.nth(0)).toContainText('BATCH-SUP');
  await expect(batchesCard.locator('.product-cost-summary')).toContainText('Last purchase price');
  await expect(batchesCard.locator('.product-cost-summary')).toContainText('3.00');
  await expect(page.locator('.product-details-main .product-cost-summary')).toHaveCount(0);
  const actions = await page.locator('.product-details-actions').boundingBox();
  const card = await batchesCard.boundingBox();
  const suppliers = await page.locator('.product-details-suppliers').boundingBox();
  expect(card!.y).toBeGreaterThanOrEqual(actions!.y + actions!.height);
  expect(suppliers!.y).toBeGreaterThanOrEqual(card!.y + card!.height);
  await batchesCard.getByRole('button', { name: /Show all/ }).click();
  await expect(batchRows).toHaveCount(3);
  await expect(batchesCard).toContainText('Cost is unknown');
  expect((await batchesCard.boundingBox())!.height).toBeGreaterThan(card!.height);
  await page.screenshot({
    path: test.info().outputPath('product-secondary-cards-desktop.png'),
    fullPage: true,
  });
  await batchesCard.getByRole('button', { name: 'Show less', exact: true }).click();
  await expect(batchRows).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await batchesCard.getByRole('button', { name: /Show all/ }).click();
  await expect(batchRows).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('unknown-stock-costs.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
