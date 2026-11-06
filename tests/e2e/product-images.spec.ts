import { test, expect } from './fixtures';
test('product photos upload, survive reload, and can be removed', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Store name').fill('Photo store');
  await page.getByLabel('Your name').fill('Photo Owner');
  await page.getByLabel('Email address').fill('photo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('photo-password-1234');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await page.getByRole('link', { name: 'Add product' }).first().click();
  const form = page.locator('.product-details-page');
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 600;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#c74822';
    ctx.fillRect(0, 0, 800, 600);
    return c.toDataURL('image/png').split(',')[1];
  });
  await form.getByLabel('Add product photos', { exact: true }).setInputFiles({
    name: 'product.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  const preview = form.getByAltText('Product photo preview');
  await expect(preview).toBeVisible();
  expect(await preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeLessThanOrEqual(
    480,
  );
  await form.getByLabel('Product name').fill('Photo product');
  await form.getByLabel('SKU', { exact: true }).fill('PHOTO-1');
  await form.getByLabel('Category', { exact: true }).fill('Test');
  await form.getByLabel('Unit', { exact: true }).selectOption('piece');
  await form.getByLabel('Selling price').fill('25');
  await form.getByRole('button', { name: 'Add product', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit product', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to products', exact: true }).click();
  await page.reload();
  await expect(page.locator('.product-icon img')).toBeVisible();
  await page.getByRole('link', { name: 'View Photo product' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit product', exact: true }).click();
  await expect(page.locator('.product-details-photo img')).toBeVisible();
  await page.getByRole('button', { name: 'Remove photo' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/products\/[^/]+$/);
  await expect(page.getByRole('button', { name: 'Edit product', exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'General information', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.product-details-photo img')).toHaveCount(0);
});
