import { test, expect } from './fixtures';
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
  await page.getByRole('link', { name: 'Add product' }).first().click();
  const form = page.locator('.product-details-page');
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
  await form.getByLabel('Scan or enter barcode').fill('3017620422003');
  await form.getByLabel('Scan or enter barcode').press('Enter');
  await expect(form.getByRole('button', { name: 'Use these details' })).toBeVisible();
  await expect(form.getByLabel('Product name')).toHaveValue('');
  await form.getByRole('button', { name: 'Use these details' }).click();
  await expect(form.getByLabel('Product name')).toHaveValue('Chocolate spread');
  await expect(form.getByLabel('Description (optional)')).toHaveValue('Hazelnut spread with cocoa');
  await expect(form.getByAltText('Product photo preview')).toBeVisible();
  await expect(form.getByLabel('Selling price')).toHaveValue('');
  await expect(form.getByLabel('Unit', { exact: true })).toHaveValue('piece');
  await form.getByLabel('SKU', { exact: true }).fill('LOOKUP-1');
  await form.getByLabel('Selling price').fill('30');
  await form.getByRole('button', { name: 'Add product', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit product', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Edit product', exact: true }).click();
  await expect(page.getByLabel('Package', { exact: true })).toHaveValue('500 g');
  await expect(page.getByLabel('Description (optional)')).toHaveValue('Hazelnut spread with cocoa');
  await expect(page.getByLabel('Scan or enter barcode')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit product', exact: true })).toBeVisible();
  await page.unroute('**/api/products/lookup/3017620422003');
  await page.getByRole('link', { name: 'Back to products', exact: true }).click();
  await page.getByRole('link', { name: 'Add product' }).first().click();
  await form.getByLabel('Scan or enter barcode').fill('3017620422003');
  await form.getByRole('button', { name: 'Look up barcode' }).click();
  await expect(form.getByRole('button', { name: 'Open existing product' })).toBeVisible();
  await form.getByRole('button', { name: 'Open existing product' }).click();
  await expect(form.getByLabel('Product name')).toHaveValue('Chocolate spread');
  await expect(page.getByRole('button', { name: 'Edit product', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to products', exact: true }).click();
  await page.getByRole('link', { name: 'Add product' }).first().click();
  await page.route('**/api/products/lookup/012345678905', (route) =>
    route.fulfill({ json: { suggestion: null } }),
  );
  await form.getByLabel('Scan or enter barcode').fill('012345678905');
  await form.getByRole('button', { name: 'Look up barcode' }).click();
  await expect(form.getByText('No match found.', { exact: false })).toBeVisible();
  await expect(form.getByLabel('Barcodes (optional)')).toHaveValue('012345678905');
});
