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
  const original = results[0];
  const edit = await page.request.patch('/api/products/' + original.id, {
    headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
    data: { ...original, name: 'Renamed apples' },
  });
  expect(edit.ok(), await edit.text()).toBe(true);
  const updated = await edit.json();
  expect(updated.sku).toBe(original.sku);
  expect(updated.plu).toBe(original.plu);
  expect(errors).toEqual([]);
});
