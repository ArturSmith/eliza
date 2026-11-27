import { test, expect } from './fixtures';

test('category and individual selection, quantities, recount, finalization and cancellation work end to end', async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  const fixtures: Record<string, { id: string }> = {};
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('Counting shop');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Email address').fill('counts@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await expect(page.getByRole('link', { name: 'Products', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Stock counts', exact: true })).toBeVisible();
  for (const name of ['Milk', 'Bread', 'Yogurt']) {
    const response = await page.request.post('/api/products', {
      headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
      data: {
        name,
        sku: name,
        category: name === 'Bread' ? 'Bakery' : 'Dairy',
        unit: name === 'Milk' ? 'kilogram' : 'piece',
        price: '10',
        cost: '5',
        taxRate: '0',
        minStock: '0',
        barcodes: [],
      },
    });
    expect(response.ok()).toBe(true);
    fixtures[name] = await response.json();
  }
  await page.goto('/stock-counts');
  await page.getByRole('button', { name: 'New stock count' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Count name').fill('Opening count');
  await dialog.getByLabel('Count notes').fill('Back room audit');
  await expect(dialog.getByRole('checkbox')).toHaveCount(3);
  await dialog.getByLabel('Category (optional)', { exact: true }).selectOption('Dairy');
  await expect(dialog.getByRole('checkbox')).toHaveCount(2);
  await expect(dialog.getByRole('checkbox', { name: /^Milk/ })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /^Yogurt/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Select all active' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.screenshot({ path: '/private/tmp/eliza-count-category-mobile.png' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await dialog.getByLabel('Category (optional)', { exact: true }).selectOption('');
  await dialog.getByRole('checkbox', { name: /^Yogurt/ }).uncheck();
  await dialog.getByRole('checkbox', { name: /^Bread/ }).check();
  await dialog.getByRole('button', { name: 'Create draft' }).click();
  await expect(dialog).not.toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Opening count' });
  await expect(row.getByRole('cell', { name: '2', exact: true })).toBeVisible();
  await expect(row).toContainText('Alex');
  await expect(page.getByRole('heading', { name: 'Opening count', exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel('Search stock counts').fill('Back room audit');
  await expect(row).toBeVisible();
  await page.getByLabel('Search stock counts').fill('Alex');
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Opening count', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start counting' })).toBeVisible();
  await expect(page.getByLabel('Counted Milk', { exact: true })).toBeDisabled();
  const start = await page
    .getByRole('button', { name: 'Start counting', exact: true })
    .boundingBox();
  const table = await page
    .getByRole('table', { name: 'Count quantities', exact: true })
    .boundingBox();
  expect(start!.y).toBeLessThan(table!.y);
  await page.getByRole('button', { name: 'Start counting', exact: true }).click();
  await expect(page.getByLabel('Counted Milk', { exact: true })).toBeEnabled();
  await page.getByLabel('Counted Milk', { exact: true }).fill('2,5');
  await page.getByLabel('Counted Bread', { exact: true }).fill('1,5');
  await page.getByRole('button', { name: 'Save quantities', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('whole-number');
  await page.getByLabel('Counted Bread', { exact: true }).fill('0');
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/quantities') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Save quantities', exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON().lines).toEqual(
    expect.arrayContaining([
      { productId: fixtures.Milk.id, quantity: '2.500' },
      { productId: fixtures.Bread.id, quantity: '0.000' },
    ]),
  );
  await expect(page.getByLabel('Counted Milk', { exact: true })).toHaveValue('2.5');
  await expect(page.getByLabel('Counted Bread', { exact: true })).toHaveValue('0');
  const beforeFinalization = await (await page.request.get('/api/products')).json();
  expect(beforeFinalization.find((p: any) => p.id === fixtures.Milk.id).stock).toBe('0.000');
  await page.reload();
  await page
    .getByRole('row')
    .filter({ hasText: 'Opening count' })
    .getByRole('button', { name: 'Open', exact: true })
    .click();
  await expect(page.getByLabel('Counted Milk', { exact: true })).toHaveValue('2.5');
  for (const width of [390, 320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const input = await page.getByLabel('Counted Milk', { exact: true }).boundingBox();
    expect(input!.x).toBeGreaterThanOrEqual(0);
    expect(input!.x + input!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width !== 320)
      await page
        .locator('.stock-count-detail')
        .screenshot({ path: '/private/tmp/eliza-count-entry-' + width + '.png' });
  }
  // Stock changes during a count require an explicit restart rather than losing live sales/receipts.
  expect(
    (
      await page.request.post('/api/inventory/adjustments', {
        headers,
        data: {
          requestId: crypto.randomUUID(),
          productId: fixtures.Milk.id,
          quantity: '1',
          unitCost: null,
          reason: 'other',
        },
      })
    ).ok(),
  ).toBe(true);
  await expect(page.getByRole('button', { name: 'Review count', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Review count', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Finalize count', exact: true })).toBeDisabled();
  await expect(page.getByText(/Stock moved after this count started/)).toBeVisible();
  await page.getByRole('button', { name: 'Restart count', exact: true }).click();
  const restart = page.getByRole('dialog', { name: 'Restart stock count', exact: true });
  await restart.getByLabel('Reason', { exact: true }).fill('Stock changed during count');
  await restart.getByRole('button', { name: 'Confirm restart', exact: true }).click();
  await expect(restart).toHaveCount(0);
  await expect(page.getByLabel('Counted Milk', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Counted Bread', { exact: true })).toHaveValue('');
  await page.getByLabel('Counted Milk', { exact: true }).fill('2,500');
  await page.getByLabel('Counted Bread', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Save quantities', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review count', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Review count', exact: true }).click();
  await page.getByRole('button', { name: 'Finalize count', exact: true }).click();
  const finalize = page.getByRole('dialog', { name: 'Finalize stock count', exact: true });
  await finalize.getByRole('button', { name: 'Confirm finalization', exact: true }).click();
  await expect(finalize).toHaveCount(0);
  await expect(page.getByLabel('Counted Milk', { exact: true })).toHaveCount(0);
  const products = await (await page.request.get('/api/products')).json();
  expect(products.find((p: any) => p.name === 'Milk').stock).toBe('2.500');
  expect(products.find((p: any) => p.name === 'Bread').stock).toBe('0.000');
  expect(products.find((p: any) => p.name === 'Yogurt').stock).toBe('0.000');
  // Individual product selection remains available without selecting a category.
  await page.getByRole('button', { name: 'New stock count', exact: true }).click();
  await dialog.getByLabel('Count name', { exact: true }).fill('Manual count');
  await expect(dialog.getByLabel('Category (optional)', { exact: true })).toHaveValue('');
  await dialog.getByRole('checkbox', { name: /^Yogurt/ }).check();
  await dialog.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page.getByLabel('Counted Yogurt', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel count', exact: true }).click();
  const cancel = page.getByRole('dialog', { name: 'Cancel stock count', exact: true });
  await cancel.getByLabel('Reason', { exact: true }).fill('Not needed');
  await cancel.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
  await expect(cancel).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'Manual count' })).toContainText(
    'cancelled',
  );
  expect(
    (await (await page.request.get('/api/products')).json()).find(
      (p: any) => p.id === fixtures.Milk.id,
    ).stock,
  ).toBe('2.500');
  expect(errors).toEqual([]);
});
