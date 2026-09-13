import { test, expect } from '@playwright/test';

test('new stock-count draft renders in the list and reopens after reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('Counting shop');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Email address').fill('counts@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await expect(page.getByRole('link', { name: 'Stock counts', exact: true })).toBeVisible();
  for (const name of ['Milk', 'Bread']) {
    const response = await page.request.post('/api/products', {
      headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
      data: {
        name,
        sku: name,
        category: 'Food',
        unit: 'piece',
        price: '10',
        cost: '5',
        taxRate: '0',
        minStock: '0',
        barcodes: [],
      },
    });
    expect(response.ok()).toBe(true);
  }
  await page.goto('/stock-counts');
  await page.getByRole('button', { name: 'New stock count' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Count name').fill('Opening count');
  await dialog.getByLabel('Count notes').fill('Back room audit');
  await expect(dialog.getByRole('checkbox')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Select all active' }).click();
  await dialog.getByRole('button', { name: 'Create draft' }).click();
  await expect(dialog).not.toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Opening count' });
  await expect(row.getByRole('cell', { name: '2', exact: true })).toBeVisible();
  await expect(row).toContainText('Alex');
  await expect(page.getByRole('heading', { name: 'Opening count', exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel('Search stock counts').fill('Back room audit');
  await expect(row).toBeVisible();
  await page.getByLabel('Search stock counts').fill('Alex');
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Opening count', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start counting' })).toBeVisible();
  expect(errors).toEqual([]);
});
