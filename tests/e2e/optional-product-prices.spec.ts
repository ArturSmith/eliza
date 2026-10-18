import { test, expect } from '@playwright/test';

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
  await page.getByRole('button', { name: 'Add product' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Product name').fill('Unpriced yogurt');
  await dialog.getByLabel('SKU', { exact: true }).fill('UNKNOWN-YOG');
  await dialog.getByLabel('Category', { exact: true }).fill('Dairy');
  await expect(dialog.getByLabel('Purchase cost (optional)', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('Selling price (optional)', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: 'Create product' }).click();
  await expect(dialog).not.toBeVisible();
  const products = await (await page.request.get('/api/products')).json();
  const product = products.find((p: any) => p.sku === 'UNKNOWN-YOG');
  expect(product).toMatchObject({ price: null, cost: null });
  await page.getByRole('button', { name: 'Edit Unpriced yogurt', exact: true }).click();
  await expect(dialog.getByLabel('Selling price (optional)', { exact: true })).toHaveValue('');
  await dialog.getByLabel('Purchase cost (optional)', { exact: true }).fill('59');
  await dialog.getByLabel('Selling price (optional)', { exact: true }).fill('70');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).not.toBeVisible();
  const saved = (await (await page.request.get('/api/products')).json()).find(
    (p: any) => p.id === product.id,
  );
  expect(saved).toMatchObject({ price: '70.00', cost: '59.00' });
  expect(errors).toEqual([]);
});
