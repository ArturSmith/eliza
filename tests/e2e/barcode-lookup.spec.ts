import { test, expect } from '@playwright/test';
test('barcode creation reviews suggestions, saves attribution, and falls back to manual entry', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Store name').fill('Lookup store');
  await page.getByLabel('Your name').fill('Alex Morgan');
  await page.getByLabel('Email address').fill('alex@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await page.getByRole('button', { name: 'Add product' }).first().click();
  const dialog = page.getByRole('dialog');
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 10;
    c.height = 10;
    return c.toDataURL('image/jpeg');
  });
  await page.route('**/api/products/lookup/3017620422003', (route) =>
    route.fulfill({
      json: {
        suggestion: {
          barcode: '3017620422003',
          name: 'Chocolate spread',
          description: 'Hazelnut spread with cocoa',
          brand: 'Example brand',
          quantity: '500 g',
          category: 'Spreads',
          image,
        },
      },
    }),
  );
  await dialog.getByLabel('Scan or enter barcode').fill('3017620422003');
  await dialog.getByLabel('Scan or enter barcode').press('Enter');
  await expect(dialog.getByRole('button', { name: 'Use these details' })).toBeVisible();
  await expect(dialog.getByLabel('Product name')).toHaveValue('');
  await dialog.getByRole('button', { name: 'Use these details' }).click();
  await expect(dialog.getByLabel('Product name')).toHaveValue('Chocolate spread');
  await expect(dialog.getByLabel('Description (optional)')).toHaveValue(
    'Hazelnut spread with cocoa',
  );
  await expect(dialog.getByAltText('Product photo preview')).toBeVisible();
  await expect(dialog.getByLabel('Selling price')).toHaveValue('');
  await expect(dialog.getByLabel('Unit', { exact: true })).toHaveValue('piece');
  await dialog.getByLabel('SKU', { exact: true }).fill('LOOKUP-1');
  await dialog.getByLabel('Selling price').fill('30');
  await dialog.getByLabel('Purchase cost').fill('15');
  await dialog.getByRole('button', { name: 'Create product' }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Edit Chocolate spread' }).click();
  await expect(dialog.getByText('Package: 500 g', { exact: false })).toBeVisible();
  await expect(dialog.getByLabel('Description (optional)')).toHaveValue(
    'Hazelnut spread with cocoa',
  );
  await expect(dialog.getByLabel('Scan or enter barcode')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).not.toBeVisible();
  await page.unroute('**/api/products/lookup/3017620422003');
  await page.getByRole('button', { name: 'Add product' }).first().click();
  await dialog.getByLabel('Scan or enter barcode').fill('3017620422003');
  await dialog.getByRole('button', { name: 'Look up barcode' }).click();
  await expect(dialog.getByRole('button', { name: 'Open existing product' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Open existing product' }).click();
  await expect(dialog.getByLabel('Product name')).toHaveValue('Chocolate spread');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Add product' }).first().click();
  await page.route('**/api/products/lookup/012345678905', (route) =>
    route.fulfill({ json: { suggestion: null } }),
  );
  await dialog.getByLabel('Scan or enter barcode').fill('012345678905');
  await dialog.getByRole('button', { name: 'Look up barcode' }).click();
  await expect(dialog.getByText('No match found.', { exact: false })).toBeVisible();
  await expect(dialog.getByLabel('Barcodes (optional)')).toHaveValue('012345678905');
});
