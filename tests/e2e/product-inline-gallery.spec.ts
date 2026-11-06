import { test, expect } from './fixtures';
import sharp from 'sharp';

test('creates a blank product, edits inline with dirty/cancel/save states, and persists a compatible gallery', async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  async function post(path: string, data: unknown, method = 'POST') {
    const response = await page.request.fetch('/api' + path, { method, headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  await post('/auth/setup', {
    storeName: 'Gallery shop',
    ownerName: 'Owner',
    email: 'gallery@example.test',
    password: 'test-password-12345',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  });
  await page.goto('/products');
  await page.getByRole('link', { name: 'Add product', exact: true }).first().click();
  await expect(page).toHaveURL('/products/new');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const label of [
    'Product name',
    'Description (optional)',
    'Category',
    'SKU',
    'PLU / short code (optional)',
    'Barcodes (optional)',
    'Selling price (optional)',
    'Tax rate (%)',
    'Low-stock threshold',
    'Unit',
  ]) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
  }
  await page.getByLabel('Product name', { exact: true }).fill('Gallery yogurt');
  await page.getByLabel('Category', { exact: true }).fill('Dairy');
  await page.getByLabel('Unit', { exact: true }).selectOption('piece');
  await page.getByLabel('Selling price (optional)', { exact: true }).fill('70');
  await expect(page.getByLabel('Estimated gross margin', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('textbox', { name: 'Estimated gross margin', exact: true }),
  ).toHaveCount(0);
  const photos = await Promise.all(
    ['#ac3d26', '#367b99', '#5b8e53'].map(async (background, index) => ({
      name: `photo-${index}.jpg`,
      mimeType: 'image/jpeg',
      buffer: await sharp({ create: { width: 800, height: 600, channels: 3, background } })
        .jpeg()
        .toBuffer(),
    })),
  );
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add photo', exact: true }).click();
  await (await chooser).setFiles(photos.slice(0, 2));
  await expect(page.locator('.product-photo-thumbnail')).toHaveCount(2);
  await expect(page.getByAltText('Product photo preview')).toHaveJSProperty('naturalWidth', 480);
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/products') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  const product = await (await created).json();
  await expect(page).toHaveURL('/products/' + product.id);
  await expect(page.getByRole('button', { name: 'Edit product', exact: true })).toBeVisible();
  expect(product.images).toHaveLength(2);
  expect(product.image).toBe(product.images[0]);
  expect(product.sku).toBeTruthy();
  expect(product.plu).toBeTruthy();
  expect(product.barcodes[0]).toMatch(/^04\d{11}$/);
  await page.getByRole('button', { name: 'Record stock', exact: true }).click();
  const stockForm = page.getByRole('region', { name: 'Record stock', exact: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(stockForm).toContainText('Gallery yogurt');
  await expect(
    stockForm.getByRole('button', { name: 'Select a product', exact: true }),
  ).toHaveCount(0);
  await expect(stockForm.getByLabel('Reason', { exact: true })).toHaveValue('received');
  await stockForm.getByLabel('Quantity change', { exact: true }).fill('5');
  await stockForm.getByLabel('Reason', { exact: true }).selectOption('opening_balance');
  await stockForm.getByLabel('Cost per unit for this stock').fill('59');
  await stockForm.getByLabel('Notes', { exact: true }).fill('Initial stock from the product page');
  await stockForm.getByRole('button', { name: 'Record adjustment', exact: true }).click();
  await expect(stockForm).not.toBeVisible();
  await expect(page.getByLabel('On hand', { exact: true })).toContainText('5 piece');
  const history = await (
    await page.request.get('/api/inventory/movements/history?productId=' + product.id)
  ).json();
  expect(history.rows).toHaveLength(1);
  expect(history.rows[0]).toMatchObject({
    productId: product.id,
    quantity: '5.000',
    balance: '5.000',
    reason: 'opening_balance',
    notes: 'Initial stock from the product page',
  });
  const url = page.url();
  const name = page.getByLabel('Product name', { exact: true });
  await expect(name).toHaveAttribute('readonly');
  await page.getByRole('button', { name: 'Edit product', exact: true }).click();
  await expect(page).toHaveURL(url);
  await expect(name).not.toHaveAttribute('readonly');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(1);
  await name.fill('Temporary name');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await name.fill('Gallery yogurt');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(name).toHaveAttribute('readonly');
  await page.getByRole('button', { name: 'Edit product', exact: true }).click();
  await page.getByLabel('Selling price (optional)', { exact: true }).fill('75');
  await expect(page.getByLabel('Estimated gross margin', { exact: true })).toContainText('21.33%');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Selling price (optional)', { exact: true })).toHaveValue('70.00');
  await expect(page.getByLabel('Estimated gross margin', { exact: true })).toContainText('15.71%');
  await page.getByLabel('Add product photos', { exact: true }).setInputFiles(photos[2]);
  await expect(page.locator('.product-photo-thumbnail')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  expect(
    (await (await page.request.get('/api/products')).json()).find((p: any) => p.id === product.id)
      .images,
  ).toHaveLength(2);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit product', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.product-photo-thumbnail')).toHaveCount(3);
  await page.getByRole('button', { name: 'Photo 3', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Photo 3', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Edit product', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit product', exact: true }).click();
  await page.getByRole('button', { name: 'Use as cover', exact: true }).click();
  await page
    .getByLabel('Description (optional)', { exact: true })
    .fill('Three views of our yogurt.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit product', exact: true })).toBeVisible();
  const saved = (await (await page.request.get('/api/products')).json()).find(
    (p: any) => p.id === product.id,
  );
  expect(saved.images).toHaveLength(3);
  expect(saved.image).toBe(saved.images[0]);
  expect(saved.image).not.toBe(product.image);
  expect(saved).toMatchObject({
    price: '70.00',
    cost: null,
    averageCost: '59.00',
    stockValue: '295.00',
    stock: '5.000',
    description: 'Three views of our yogurt.',
  });
  const { images: omitted, ...legacy } = saved;
  const compatible = await post(
    '/products/' + product.id,
    { ...legacy, name: 'Gallery yogurt' },
    'PATCH',
  );
  expect(compatible.images).toEqual(saved.images);
  const cleared = await post('/products/' + product.id, { ...compatible, images: [] }, 'PATCH');
  expect(cleared.images).toEqual([]);
  expect(cleared.image).toBe('');
  const invalid = await page.request.patch('/api/products/' + product.id, {
    headers,
    data: { ...cleared, images: Array(7).fill(saved.image) },
  });
  expect(invalid.status()).toBe(400);
  const audits = await (await page.request.get('/api/audit')).json();
  expect(JSON.stringify(audits)).not.toContain('data:image/');
  // Restore the gallery so the visual checks cover a full thumbnail row.
  await post('/products/' + product.id, saved, 'PATCH');
  await page.reload();
  await expect(page.locator('.product-photo-thumbnail')).toHaveCount(3);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: test.info().outputPath('inline-product-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: test.info().outputPath('inline-product-mobile.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
