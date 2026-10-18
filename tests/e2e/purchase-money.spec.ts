import { test, expect } from './fixtures';

test('purchase history renders money from the real paginated API', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('Purchase money shop');
  await page.getByLabel('Your name').fill('Owner');
  await page.getByLabel('Email address').fill('purchase-money@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await expect(page.getByRole('link', { name: 'Purchases', exact: true })).toBeVisible();
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post('/api' + path, { headers, data });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const supplier = await post('/suppliers', {
    requestId: crypto.randomUUID(),
    code: 'TEST',
    name: 'Test supplier',
  });
  const product = await post('/products', {
    name: 'Yogurt',
    sku: 'YOG',
    category: 'Dairy',
    unit: 'piece',
    price: '15',
    cost: '10.13',
    taxRate: '0',
    minStock: '0',
    barcodes: [],
    plu: '',
  });
  const order = await post('/purchases', {
    requestId: crypto.randomUUID(),
    supplierId: supplier.id,
    lines: [
      { productId: product.id, quantity: '1', unitCost: '10.13', taxRate: '0', sellingPrice: '15' },
    ],
  });
  const response = page.waitForResponse(
    (r) => r.url().includes('/api/purchases?') && r.request().method() === 'GET',
  );
  await page.goto('/purchases');
  const body = await (await response).json();
  expect(body.rows[0].total).toBe('10.13');
  const row = page.getByRole('row').filter({ hasText: order.number });
  await expect(row).toContainText('10.13');
  await expect(page.getByText('Page 1 of 1', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
