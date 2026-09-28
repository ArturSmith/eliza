import { test, expect } from '@playwright/test';
test('generates product codes without translating names', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('Planning shop');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Email address').fill('shopping@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await expect(page.getByRole('link', { name: 'Shopping lists', exact: true })).toBeVisible();

  async function post(path: string, data: unknown) {
    const response = await page.request.post('/api' + path, {
      headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }

  await page.goto('/products');
  await page.getByRole('button', { name: 'Add product', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Product name', { exact: true }).fill('Зелёные яблоки');
  await expect(dialog.getByLabel('PLU / short code (optional)', { exact: true })).toHaveValue('1');
  await expect(dialog.getByLabel('SKU', { exact: true })).toHaveValue('Зелёные-яблоки-1');
  await dialog.getByLabel('PLU / short code (optional)', { exact: true }).fill('42');
  await expect(dialog.getByLabel('SKU', { exact: true })).toHaveValue('Зелёные-яблоки-42');
  const payload = {
    name: 'Яблоки',
    sku: 'preview',
    category: 'Fruit',
    unit: 'kilogram',
    price: '30',
    cost: '10',
    minStock: '0',
    plu: '1',
    barcodes: [],
    autoPlu: true,
    autoSku: true,
  };
  const results = await Promise.all([post('/products', payload), post('/products', payload)]);
  expect(results.map((p: any) => p.plu).sort()).toEqual(['1', '2']);
  expect(results.every((p: any) => p.sku === 'Яблоки-' + p.plu)).toBe(true);
  expect(results.every((p: any) => /^04\d{11}$/.test(p.barcodes[0]))).toBe(true);
  expect(results[0].barcodes[0]).not.toBe(results[1].barcodes[0]);
  const original = results[0];
  const edit = await page.request.patch('/api/products/' + original.id, {
    headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
    data: { ...original, name: 'Renamed apples' },
  });
  expect(edit.ok(), await edit.text()).toBe(true);
  const updated = await edit.json();
  expect(updated.sku).toBe(original.sku);
  expect(updated.plu).toBe(original.plu);
  await page.reload();
  await page.getByRole('button', { name: original.barcodes[0] }).click();
  await expect(
    page.getByRole('dialog').getByRole('img', { name: `Barcode ${original.barcodes[0]}` }),
  ).toBeVisible();
  await expect(
    page.getByRole('dialog').locator('.product-barcode-print svg rect').first(),
  ).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Print barcode' }),
  ).toBeEnabled();
  await page.evaluate(() => {
    (window as any).__printed = false;
    window.print = () => {
      (window as any).__printed = true;
    };
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Print barcode' }).click();
  expect(await page.evaluate(() => (window as any).__printed)).toBe(true);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Delete Renamed apples' }).click();
  await expect(page.getByRole('heading', { name: 'Delete product?' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete product' }).click();
  await expect(page.getByRole('cell', { name: /Renamed apples/ })).toHaveCount(0);
  await expect
    .poll(async () =>
      (await page.request.get('/api/products').then((r) => r.json())).some(
        (p: any) => p.id === original.id,
      ),
    )
    .toBe(false);
  const remaining = results[1];
  await post('/inventory/adjustments', {
    productId: remaining.id,
    quantity: '1',
    reason: 'count_correction',
    notes: 'Deletion guard test',
    requestId: crypto.randomUUID(),
  });
  const stocked = await page.request.delete('/api/products/' + remaining.id, {
    headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
  });
  expect(stocked.status()).toBe(409);
  expect((await stocked.json()).message).toContain('stock on hand');
  await post('/inventory/adjustments', {
    productId: remaining.id,
    quantity: '-1',
    reason: 'count_correction',
    notes: 'Deletion guard test',
    requestId: crypto.randomUUID(),
  });
  const blocked = await page.request.delete('/api/products/' + remaining.id, {
    headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
  });
  expect(blocked.status()).toBe(409);
  expect((await blocked.json()).message).toContain('Deactivate it instead');
  expect(
    (await page.request.get('/api/products').then((r) => r.json())).some(
      (p: any) => p.id === remaining.id,
    ),
  ).toBe(true);

  expect(errors).toEqual([]);
});
