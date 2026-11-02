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
  await expect(form.getByLabel('Purchase cost (optional)', { exact: true })).toHaveValue('');
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
  await page.getByLabel('Purchase cost (optional)', { exact: true }).fill('59');
  await page.getByLabel('Selling price (optional)', { exact: true }).fill('70');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/products\/[^/]+$/);
  await expect(page.getByRole('button', { name: 'Edit product', exact: true })).toBeVisible();
  const saved = (await (await page.request.get('/api/products')).json()).find(
    (p: any) => p.id === product.id,
  );
  expect(saved).toMatchObject({ price: '70.00', cost: '59.00' });
  expect(errors).toEqual([]);
});
