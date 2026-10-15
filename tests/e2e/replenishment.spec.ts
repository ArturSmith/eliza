import { test, expect } from '@playwright/test';
test('replenishment shows new-product uncertainty and supports filters on desktop and mobile', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('Planning shop');
  await page.getByLabel('Your name').fill('Owner');
  await page.getByLabel('Email address').fill('planning@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await expect(page.getByRole('link', { name: 'Products', exact: true })).toBeVisible();
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  const created = await page.request.post('/api/products', {
    headers,
    data: {
      name: 'Planning yogurt',
      sku: 'PLAN-YOG',
      category: 'Dairy',
      unit: 'piece',
      price: '10',
      cost: '5',
      taxRate: '0',
      minStock: '0',
      plu: '123',
      barcodes: ['709123'],
    },
  });
  expect(created.ok()).toBeTruthy();
  const product = await created.json();
  expect(
    (
      await page.request.post('/api/inventory/adjustments', {
        headers,
        data: {
          requestId: crypto.randomUUID(),
          productId: product.id,
          quantity: '10',
          reason: 'opening_balance',
          notes: 'Initial count',
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto('/replenishment');
  await expect(page.getByRole('heading', { name: 'Replenishment', exact: true })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('Insufficient history');
  await expect(page.getByLabel('History days')).toHaveValue('28');
  await page.getByLabel('Status', { exact: true }).selectOption('no_sales');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByText('No matching products.', { exact: true })).toBeVisible();
  await page.getByLabel('Status', { exact: true }).selectOption('all');
  await page.getByLabel('Search products').fill('PLAN-YOG');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByText('How quantities are calculated', { exact: true }).click();
  await expect(page.getByText(/Target stock = average daily sales/)).toBeVisible();
  await page.screenshot({ path: '/private/tmp/eliza-replenishment-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Search products')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: '/private/tmp/eliza-replenishment-mobile.png', fullPage: true });
});
