import { test, expect } from '@playwright/test';

test('inventory searches and pages past 100 movements without losing filters', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('History shop');
  await page.getByLabel('Your name').fill('Owner');
  await page.getByLabel('Email address').fill('history@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await expect(page.getByRole('link', { name: 'Products', exact: true })).toBeVisible();
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  const created = await page.request.post('/api/products', {
    headers,
    data: {
      name: 'History milk',
      sku: 'HISTORY-MILK',
      category: 'Dairy',
      unit: 'piece',
      price: '10.00',
      cost: '5.00',
      taxRate: '0',
      minStock: '0',
      plu: '101',
      barcodes: ['709101'],
    },
  });
  expect(created.ok()).toBeTruthy();
  const product = await created.json();
  for (let n = 0; n < 105; n++) {
    const response = await page.request.post('/api/inventory/adjustments', {
      headers,
      data: {
        requestId: crypto.randomUUID(),
        productId: product.id,
        quantity: '1',
        reason: 'received',
        notes: 'Delivery ' + n,
      },
    });
    expect(response.ok()).toBeTruthy();
  }
  await page.goto('/inventory');
  await page.getByLabel('Search movements').fill('HISTORY-MILK');
  await expect(page.getByText('Page 1 of 3', { exact: true })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(50);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Page 2 of 3', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Page 3 of 3', { exact: true })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await page.getByLabel('Search movements').fill('no-such-product');
  await expect(page.getByText('No matching movements', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.getByText('Page 1 of 3', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Search movements')).toBeVisible();
});
