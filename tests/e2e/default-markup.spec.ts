import { test, expect } from '@playwright/test';

test('applies saved markup on purchase-cost changes and allows selling-price overrides', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('Markup shop');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Email address').fill('markup@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await expect(page.getByRole('link', { name: 'Products', exact: true })).toBeVisible();
  const profile = () => page.request.get('/api/store-profile').then((r) => r.json());
  const post = (data: unknown) =>
    page.request.post('/api/store-profile', {
      headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
      data,
    });
  expect((await profile()).defaultMarkupPercent).toBe('15.00');
  await page.goto('/products');
  await page.getByRole('button', { name: 'Add product', exact: true }).first().click();
  const add = page.getByRole('dialog');
  await add.getByLabel('Product name', { exact: true }).fill('Markup milk');
  await add.getByLabel('Category', { exact: true }).fill('Dairy');
  await add.getByLabel('Purchase cost', { exact: true }).fill('100');
  await expect(add.getByLabel('Selling price', { exact: true })).toHaveValue('115.00');
  await expect(add.locator('.product-margin-preview')).toContainText('13.04%');
  await add.getByLabel('Tax rate (%)', { exact: true }).fill('25');
  await expect(add.getByLabel('Selling price', { exact: true })).toHaveValue('115.00');
  await add.getByLabel('Purchase cost', { exact: true }).fill('200');
  await expect(add.getByLabel('Selling price', { exact: true })).toHaveValue('230.00');
  await add.getByLabel('Selling price', { exact: true }).fill('240');
  await add.getByLabel('Purchase cost', { exact: true }).fill('300');
  await expect(add.getByLabel('Selling price', { exact: true })).toHaveValue('345.00');
  await add.getByLabel('Selling price', { exact: true }).fill('240');
  await expect(add.getByLabel('Selling price', { exact: true })).toHaveValue('240');
  await expect(add.locator('.product-margin-preview')).toContainText('-56.25%');
  await add.getByLabel('Tax rate (%)', { exact: true }).fill('0');
  await expect(add.locator('.product-margin-preview')).toContainText('-25.00%');
  await add.getByLabel('Tax rate (%)', { exact: true }).fill('25');
  await expect(add.getByRole('button', { name: 'Use default markup' })).toHaveCount(0);
  await add.getByLabel('Selling price', { exact: true }).fill('115.00');
  await add.getByLabel('Purchase cost', { exact: true }).fill('100');
  await add.getByRole('button', { name: 'Create product', exact: true }).click();
  await expect(add).not.toBeVisible();

  await page.goto('/settings');
  const setting = page.getByLabel('Default selling markup (%)', { exact: true });
  await expect(setting).toHaveValue('15.00');
  await setting.fill('25');
  await page.getByRole('button', { name: 'Save store settings' }).click();
  await expect(setting).toHaveValue('25.00');
  await page.reload();
  await expect(setting).toHaveValue('25.00');
  const saved = await profile();
  expect((await post({ ...saved, defaultMarkupPercent: '-1' })).status()).toBe(400);
  expect((await post({ ...saved, defaultMarkupPercent: '1000.01' })).status()).toBe(400);
  const { defaultMarkupPercent: _, ...oldClient } = saved;
  expect((await post(oldClient)).status()).toBe(201);
  expect((await profile()).defaultMarkupPercent).toBe('25.00');
  expect((await post(saved)).status()).toBe(409);
  await page.goto('/products');
  await page.getByRole('button', { name: 'Edit Markup milk', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit product', exact: true });
  await expect(edit.getByLabel('Selling price', { exact: true })).toHaveValue('115.00');
  await edit.getByLabel('Purchase cost', { exact: true }).fill('200');
  await expect(edit.getByLabel('Selling price', { exact: true })).toHaveValue('250.00');
  await edit.getByLabel('Selling price', { exact: true }).fill('260');
  await expect(edit.getByLabel('Selling price', { exact: true })).toHaveValue('260');
  await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Add product', exact: true }).first().click();
  await add.getByLabel('Purchase cost', { exact: true }).fill('100');
  await expect(add.getByLabel('Selling price', { exact: true })).toHaveValue('125.00');
  await add.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.goto('/settings');
  await page.getByLabel('Language', { exact: true }).selectOption('ru');
  await expect(page.getByLabel('Наценка по умолчанию (%)', { exact: true })).toHaveValue('25.00');
  expect(errors).toEqual([]);
});
