import { test, expect } from './fixtures';
test('product photos upload, survive reload, and can be removed', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Store name').fill('Photo store');
  await page.getByLabel('Your name').fill('Photo Owner');
  await page.getByLabel('Email address').fill('photo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('photo-password-1234');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await page.getByRole('button', { name: 'Add product' }).first().click();
  const dialog = page.getByRole('dialog');
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 600;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#c74822';
    ctx.fillRect(0, 0, 800, 600);
    return c.toDataURL('image/png').split(',')[1];
  });
  await dialog
    .getByLabel('Product photo', { exact: true })
    .setInputFiles({
      name: 'product.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    });
  const preview = dialog.getByAltText('Product photo preview');
  await expect(preview).toBeVisible();
  expect(await preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeLessThanOrEqual(
    480,
  );
  await dialog.getByLabel('Product name').fill('Photo product');
  await dialog.getByLabel('SKU', { exact: true }).fill('PHOTO-1');
  await dialog.getByLabel('Category', { exact: true }).fill('Test');
  await dialog.getByLabel('Selling price').fill('25');
  await dialog.getByLabel('Purchase cost').fill('10');
  await dialog.getByRole('button', { name: 'Create product' }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.locator('.product-icon img')).toBeVisible();
  await page.getByRole('button', { name: 'Edit Photo product' }).click();
  await expect(dialog.getByAltText('Product photo preview')).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove photo' }).click();
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit Photo product' })).toBeVisible();
  await expect(page.locator('.product-icon img')).toHaveCount(0);
});
