import { test, expect, enableAdvancedFeatures } from './fixtures';

test('four stock actions lead to directed forms, counts and traceable history', async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  const setup = await page.request.post('/api/auth/setup', {
    headers,
    data: {
      storeName: 'Stock workspace',
      ownerName: 'Owner',
      email: 'stock-workspace@example.test',
      password: 'test-password-12345',
      currency: 'NOK',
      timezone: 'Europe/Oslo',
    },
  });
  expect(setup.ok()).toBe(true);
  const created = await page.request.post('/api/products', {
    headers,
    data: {
      name: 'Stock yogurt',
      sku: 'STOCK-YOGURT',
      category: 'Dairy',
      unit: 'piece',
      price: '10',
      cost: '7',
      minStock: '0',
      taxRate: '0',
      barcodes: ['709111'],
    },
  });
  expect(created.ok()).toBe(true);
  const product = await created.json();
  await page.goto('/inventory');
  const cards = page.locator('.inventory-action-card');
  await expect(cards).toHaveCount(4);
  await expect(page.locator('.movement-filters')).toHaveCount(0);
  await expect(page.getByText('Available when advanced features are enabled.')).toBeVisible();
  await page
    .locator('.inventory-actions')
    .getByRole('link', { name: /^Add stock/ })
    .click();
  await expect(page).toHaveURL('/inventory/add');
  let form = page.locator('.inventory-operation-panel');
  await form.getByRole('button', { name: 'Select a product', exact: true }).click();
  await page.getByRole('option', { name: /Stock yogurt/ }).click();
  await form.getByLabel('Quantity', { exact: true }).fill('5');
  await expect(form.getByLabel('Reason', { exact: true }).locator('option')).toHaveText([
    'Select a reason',
    'Goods received (manual)',
    'Opening stock',
    'Other',
  ]);
  await form.getByLabel('Reason', { exact: true }).selectOption('received');
  const deliverySupplier = await page.request.post('/api/suppliers', {
    headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
    data: { requestId: crypto.randomUUID(), code: 'MANUAL', name: 'Manual supplier' },
  });
  await page.reload();
  await form.getByRole('button', { name: 'Select a product', exact: true }).click();
  await form.getByRole('option').first().click();
  await form.getByLabel('Quantity', { exact: true }).fill('5');
  await form.getByLabel('Reason', { exact: true }).selectOption('received');
  await form
    .getByLabel('Supplier', { exact: true })
    .selectOption((await deliverySupplier.json()).id);
  await form.getByLabel('Cost per unit for this stock').fill('59');
  await form.getByLabel('Notes').fill('Shelf arrival');
  await form.getByRole('button', { name: 'Add stock', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stock operation recorded' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Stock operation recorded' })).toContainText(
    '5 piece',
  );
  await page.goto('/inventory/remove');
  form = page.locator('.inventory-operation-panel');
  await form.getByRole('button', { name: 'Select a product', exact: true }).click();
  await page.getByRole('option', { name: /Stock yogurt/ }).click();
  await expect(form.getByLabel('Reason', { exact: true }).locator('option')).toHaveText([
    'Select a reason',
    'Damaged goods',
    'Expired goods',
    'Lost goods',
    'Internal use',
    'Other',
  ]);
  await form.getByLabel('Quantity', { exact: true }).fill('6');
  await form.getByLabel('Reason', { exact: true }).selectOption('lost');
  await form.getByRole('button', { name: 'Remove stock', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('This adjustment would make stock negative.');
  await form.getByLabel('Quantity', { exact: true }).fill('2');
  await form.getByLabel('Notes').fill('Missing during shelf check');
  await form.getByRole('button', { name: 'Remove stock', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stock operation recorded' })).toBeVisible();
  const updated = await (await page.request.get('/api/products')).json();
  expect(updated.find((p: { id: string }) => p.id === product.id).stock).toBe('3.000');
  const history = await (await page.request.get('/api/inventory/movements/history')).json();
  expect(history.total).toBe(2);
  expect(history.rows[0]).toMatchObject({ reason: 'lost', quantity: '-2.000', balance: '3.000' });
  await page
    .locator('.inventory-operation-panel')
    .getByRole('link', { name: 'Movement history', exact: true })
    .click();
  await expect(page.getByRole('cell', { name: 'Missing during shelf check' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to inventory', exact: true }).click();
  await enableAdvancedFeatures(page);
  await page.reload();
  await page
    .locator('.inventory-actions')
    .getByRole('link', { name: /^Stock count/ })
    .click();
  await expect(page.getByRole('button', { name: 'New stock count' })).toBeVisible();
  await page.goto('/inventory/add');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL('/inventory');
  await page.evaluate(() => localStorage.setItem('eliza.language', 'ru'));
  await page.reload();
  for (const title of ['Добавить товар', 'Убрать товар', 'Инвентаризация', 'История движений'])
    await expect(
      page.locator('.inventory-actions').getByRole('heading', { name: title }),
    ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('inventory-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('inventory-mobile.png'), fullPage: true });
  await page.goto('/inventory/remove');
  await expect(page.getByRole('heading', { name: 'Убрать товар', exact: true })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('inventory-remove-mobile.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
