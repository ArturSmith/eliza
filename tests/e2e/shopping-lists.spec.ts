import { test, expect } from '@playwright/test';
test('plans low stock, saves edits, groups supplier drafts and retains order links', async ({
  page,
}) => {
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
    const r = await page.request.post('/api' + path, {
      headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
      data,
    });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  }
  const supplier = await post('/suppliers', {
    requestId: crypto.randomUUID(),
    name: 'Fresh supplier',
    code: 'FRESH',
  });
  for (const name of ['Milk', 'Bread'])
    await post('/products', {
      name,
      sku: name,
      category: 'Food',
      unit: 'piece',
      price: '10',
      cost: '5',
      taxRate: '0',
      minStock: '5',
      barcodes: [],
    });
  const extra = await post('/products', {
    name: 'Extra item',
    sku: 'EXTRA',
    category: 'Food',
    unit: 'piece',
    price: '10',
    cost: '5',
    taxRate: '0',
    minStock: '0',
    barcodes: [],
  });
  await post('/inventory/adjustments', {
    requestId: crypto.randomUUID(),
    productId: extra.id,
    quantity: '5',
    reason: 'opening_balance',
  });
  await page.goto('/shopping-lists');
  await page.getByRole('button', { name: 'New shopping list' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Shopping list name').fill('Weekly restock');
  await dialog.getByRole('button', { name: 'Generate shopping list' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Select a product', exact: true }).click();
  await page.getByRole('option', { name: /Extra item/ }).click();
  const extraRow = page.locator('.shopping-item').filter({ hasText: 'Extra item' });
  await expect(extraRow.getByLabel('Quantity to buy')).toHaveValue('0.000');
  await extraRow.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(extraRow).toHaveCount(0);
  const milk = page.locator('.shopping-item').filter({ hasText: 'Milk' });
  const bread = page.locator('.shopping-item').filter({ hasText: 'Bread' });
  await expect(milk.getByLabel('Quantity to buy')).toHaveValue('10.000');
  await milk.getByLabel('Target stock').fill('12');
  await milk.getByRole('button', { name: 'Use suggestion' }).click();
  await expect(milk.getByLabel('Quantity to buy')).toHaveValue('12.000');
  await milk.getByLabel('Quantity to buy').fill('9');
  await milk.getByLabel('Unit cost excl. tax').fill('3');
  await milk.getByLabel('Item notes').fill('Check carton');
  await milk.getByLabel('Supplier', { exact: true }).selectOption(supplier.id);
  await bread.getByLabel('Supplier', { exact: true }).selectOption(supplier.id);
  await expect(
    page.getByRole('button', { name: 'Create selected purchase drafts' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Save shopping list' }).click();
  await expect(milk.getByLabel('Quantity to buy')).toHaveValue('9.000');
  await page.reload();
  await page
    .getByRole('row')
    .filter({ hasText: 'Weekly restock' })
    .getByRole('button', { name: 'Open', exact: true })
    .click();
  await expect(milk.getByLabel('Target stock')).toHaveValue('12.000');
  await expect(milk.getByLabel('Item notes')).toHaveValue('Check carton');
  await expect(page.locator('.shopping-group')).toHaveCount(1);
  await page
    .locator('.shopping-group')
    .screenshot({ path: test.info().outputPath('shopping-group.png') });
  await page.getByLabel('Select supplier group').check();
  await page.getByRole('button', { name: 'Create selected purchase drafts' }).click();
  await expect(page.getByRole('heading', { name: 'Converted items' })).toBeVisible();
  await expect(page.locator('.shopping-item')).toHaveCount(0);
  const orders = await page.request.get('/api/purchases').then((r) => r.json());
  expect(orders).toHaveLength(1);
  expect(orders[0]).toMatchObject({ status: 'draft', total: '77.00' });
  const products = await page.request.get('/api/products').then((r) => r.json());
  expect(
    products.filter((p: any) => p.sku !== 'EXTRA').every((p: any) => p.stock === '0.000'),
  ).toBe(true);
  await page.getByRole('link', { name: orders[0].number, exact: true }).first().click();
  await expect(page.getByRole('heading', { name: orders[0].number, exact: true })).toBeVisible();
  await page.goto('/shopping-lists');
  await page.getByLabel('Language', { exact: true }).selectOption('ru');
  await expect(page.getByRole('heading', { name: 'Списки закупок', exact: true })).toBeVisible();
  await page
    .getByRole('row')
    .filter({ hasText: 'Weekly restock' })
    .getByRole('button', { name: 'Открыть', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Позиции в заказах' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
