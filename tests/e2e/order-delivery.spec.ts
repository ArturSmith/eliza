import { test, expect } from './fixtures';

test('orders quantities only, accepts actual delivery costs with margin guidance, and records payment', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  async function post(path: string, data: unknown) {
    const response = await page.request.post('/api' + path, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  await post('/auth/setup', {
    storeName: 'Order delivery shop',
    ownerName: 'Owner',
    email: 'order-delivery@example.test',
    password: 'test-password-12345',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  });
  const supplier = await post('/suppliers', {
    requestId: crypto.randomUUID(),
    code: 'DAIRY',
    name: 'Dairy supplier',
  });
  const product = await post('/products', {
    name: 'Fresh yogurt',
    sku: 'YOG',
    category: 'Dairy',
    unit: 'piece',
    price: '34.50',
    cost: '999',
    taxRate: '15',
    minStock: '0',
    barcodes: ['709000001'],
  });
  await post('/inventory/adjustments', {
    requestId: crypto.randomUUID(),
    productId: product.id,
    supplierId: supplier.id,
    quantity: '1',
    unitCost: '20',
    reason: 'received',
    notes: 'Previous actual batch',
  });
  await page.goto('/suppliers/' + supplier.id);
  await page.getByRole('link', { name: 'Create order', exact: true }).click();
  await page.getByRole('button', { name: 'Select a product', exact: true }).click();
  await page.getByRole('option', { name: /Fresh yogurt/ }).click();
  await expect(page.getByLabel('Unit cost excl. tax', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Proposed selling price incl. tax (optional)')).toHaveCount(0);
  await page.getByLabel('Quantity', { exact: true }).fill('2');
  await page.getByLabel('Expected delivery').fill('2030-12-01');
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect(page).toHaveURL(/\/purchases\/[\da-f-]+$/);
  const id = new URL(page.url()).pathname.split('/').pop()!;
  let order = await (await page.request.get('/api/purchases/' + id)).json();
  expect(order.status).toBe('ordered');
  expect(order.total).toBeNull();
  expect(order.lines[0].unit_cost).toBeNull();
  await page.getByRole('button', { name: 'Back to supplier', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Purchases', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tab', { name: 'Active orders', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const row = page.getByRole('row').filter({ hasText: order.number });
  await row.getByRole('link', { name: 'Accept delivery', exact: true }).click();
  await expect(page.getByLabel('Unit cost excl. tax', { exact: true })).toHaveValue('');
  await expect(
    page
      .locator('.delivery-price-facts > div')
      .filter({ hasText: 'Last purchase price from this supplier' })
      .locator('dd'),
  ).toContainText('NOK 20.00');
  await expect(
    page
      .locator('.delivery-price-facts > div')
      .filter({ hasText: /^Current selling price/ })
      .locator('dd'),
  ).toContainText('NOK 34.50');
  await page.getByRole('button', { name: 'Use last purchase cost', exact: true }).click();
  await expect(page.getByLabel('Unit cost excl. tax', { exact: true })).toHaveValue('20.00');
  await page.getByLabel('Unit cost excl. tax', { exact: true }).fill('21');
  await page.getByLabel('Quantity', { exact: true }).fill('2');
  await page.getByLabel('Purchase tax %', { exact: true }).fill('15');
  await expect(page.getByText('30%', { exact: true }).first()).toBeVisible();
  await page.getByLabel('New selling price incl. tax (optional)').fill('46');
  await expect(
    page.locator('.delivery-margin-preview dd').filter({ hasText: '47.5%' }),
  ).toBeVisible();
  await expect(page.getByText('Change: +14.17 percentage points', { exact: true })).toBeVisible();
  await page.locator('.delivery-price-confirmation input').check();
  await page.getByLabel('Payment status', { exact: true }).selectOption('paid');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: test.info().outputPath(`accept-delivery-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByRole('button', { name: 'Accept delivery', exact: true }).click();
  await expect(page).toHaveURL('/purchases/' + id);
  order = await (await page.request.get('/api/purchases/' + id)).json();
  expect(order.status).toBe('received');
  expect(order.total).toBe('48.30');
  expect(order.payment_status).toBe('paid');
  const saved = (await (await page.request.get('/api/products')).json()).find(
    (p: any) => p.id === product.id,
  );
  expect(saved.stock).toBe('3.000');
  expect(saved.price).toBe('46.00');
  expect(saved.stockValue).toBe('62.00');
  await page.getByRole('button', { name: 'Back to supplier', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Delivered', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('row').filter({ hasText: order.number })).toContainText('Paid');
  await page.getByRole('tab', { name: 'Active orders', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: order.number })).toHaveCount(0);
  expect(errors).toEqual([]);
});
