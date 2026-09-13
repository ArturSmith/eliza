import { test, expect } from '@playwright/test';
test('closes a partial purchase without changing delivered quantities', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('Planning shop');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Email address').fill('shopping@example.test');
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
  const supplier = await post('/suppliers', {
    requestId: crypto.randomUUID(),
    code: 'CLOSE',
    name: 'Test supplier',
  });
  const product = await post('/products', {
    name: 'Milk',
    sku: 'CLOSE',
    category: 'Dairy',
    unit: 'piece',
    price: '10',
    cost: '5',
    minStock: '0',
    barcodes: [],
    plu: '',
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
  order = await post('/purchases/' + order.id + '/receipts', {
    requestId: crypto.randomUUID(),
    version: order.version,
    lines: [{ purchaseLineId: order.lines[0].id, quantity: '3' }],
  });
  await page.goto('/purchases?order=' + order.id);
  await page.getByRole('button', { name: 'Close remaining quantities', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Milk: 7 piece')).toBeVisible();
  await dialog.getByLabel('Closure reason').fill('Supplier cannot deliver the rest');
  await dialog.getByRole('button', { name: 'Confirm closure', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Remaining quantities closed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Receive delivery', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('columnheader', { name: 'Closed quantity', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText('Supplier cannot deliver the rest', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
