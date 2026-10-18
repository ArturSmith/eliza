import { test, expect } from './fixtures';

test('manager can open the Action Center, review an alert, and inspect no-sales controls', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('Action Center shop');
  await page.getByLabel('Your name').fill('Owner');
  await page.getByLabel('Email address').fill('actions@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await expect(page.getByRole('link', { name: 'Products', exact: true })).toBeVisible();
  const response = await page.request.post('/api/products', {
    headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
    data: {
      name: 'Action cola',
      sku: 'ACTION-COLA',
      category: 'Drinks',
      unit: 'piece',
      price: '30.00',
      cost: '10.00',
      taxRate: '0',
      minStock: '1',
      plu: '105',
      barcodes: ['709105'],
    },
  });
  expect(response.status()).toBe(201);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Manager Action Center/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View all actions' })).toBeVisible();
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: /Manager Action Center/ })).toHaveCount(0);
  await page.goto('/action-center');
  await expect(page.getByRole('heading', { name: 'Manager Action Center' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Setup/ })).toBeVisible();
  await page.getByRole('button', { name: 'Mark seen' }).first().click();
  await expect(page.getByText('SEEN', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Opportunities/ }).click();
  await expect(page.getByRole('heading', { name: 'Products without sales' })).toBeVisible();
  await expect(page.getByLabel('Custom days')).toHaveValue('60');
  await page.getByLabel('Custom days').fill('30');
  await expect(page.getByText('Temporary analysis threshold.')).toBeVisible();
  await page.getByRole('button', { name: 'Set 30 days as store default' }).click();
  await expect(
    page.getByRole('button', { name: 'Set 30 days as store default' }),
  ).not.toBeVisible();
  await expect(page.getByLabel('Custom days')).toHaveValue('30');
  const profile = await page.request.get('/api/store-profile').then((r) => r.json());
  expect(profile.noSalesThresholdDays).toBe(30);
  await page.goto('/action-center?analysis=no-sales');
  await expect(page.getByRole('button', { name: /Opportunities/ })).toHaveClass(/active/);
  await expect(page.getByRole('heading', { name: 'Products without sales' })).toBeVisible();
  await page.goto('/settings');
  await page.getByLabel('No sales threshold', { exact: true }).selectOption('custom');
  await page.getByLabel('No sales threshold (days)', { exact: true }).fill('45');
  await page.getByRole('button', { name: 'Save store settings' }).click();
  await page.goto('/action-center?analysis=no-sales');
  await expect(page.getByLabel('Custom days')).toHaveValue('45');
});
