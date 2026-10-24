import { test, expect } from './fixtures';

test('creates and manages unit markdowns in Promotions and keeps checkout costs and regular prices', async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  async function post(path: string, data: unknown, method = 'POST', client = page.request) {
    const response = await client.fetch('/api' + path, { method, headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  const account = { email: 'markdown-workspace@example.test', password: 'test-password-12345' };
  await post('/auth/setup', {
    storeName: 'Unified discounts',
    ownerName: 'Owner',
    ...account,
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  });
  const product = await post('/products', {
    name: 'Yogurt',
    sku: 'YOG',
    category: 'Dairy',
    unit: 'piece',
    price: '70',
    cost: '59',
    minStock: '0',
    taxRate: '0',
    plu: '',
    barcodes: ['0400000000046'],
  });
  await post('/products', {
    name: 'Loose apples',
    sku: 'KG',
    category: 'Fruit',
    unit: 'kilogram',
    price: '20',
    cost: '10',
    minStock: '0',
    taxRate: '0',
    plu: '20',
    barcodes: [],
  });
  await post('/products', {
    name: 'Unknown price',
    sku: 'UNKNOWN',
    category: 'Dairy',
    unit: 'piece',
    price: null,
    cost: null,
    minStock: '0',
    taxRate: '0',
    plu: '',
    barcodes: [],
  });
  await post('/inventory/adjustments', {
    requestId: crypto.randomUUID(),
    productId: product.id,
    quantity: '10',
    reason: 'opening_balance',
  });
  await page.goto('/products');
  await page.getByRole('button', { name: 'Edit Yogurt', exact: true }).click();
  const edit = page.getByRole('dialog');
  await expect(edit.getByRole('region', { name: 'Unit markdown', exact: true })).toHaveCount(0);
  await edit.getByRole('button', { name: 'Close dialog' }).click();
  await page.goto('/promotions');
  await page.getByRole('checkbox', { name: /Yogurt/ }).check();
  await page.getByLabel('Discount type').selectOption('FIXED_PRICE');
  await page.getByLabel('Final selling price', { exact: true }).fill('60');
  await page.getByLabel('Promotion name').fill('Yogurt offer');
  await page.getByRole('button', { name: 'Create promotion', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Yogurt offer', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Unit markdowns', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'Unit markdowns', exact: true });
  const productInput = workspace.getByRole('combobox', { name: 'Find a product for markdown' });
  await expect(productInput).toHaveValue('');
  await expect(workspace.getByRole('region', { name: 'Unit markdown', exact: true })).toHaveCount(
    0,
  );
  await expect(workspace.getByRole('listbox')).toHaveCount(0);
  await productInput.click();
  await expect(workspace.getByRole('listbox').getByRole('option')).toHaveCount(2);
  await expect(workspace.getByRole('region', { name: 'Unit markdown', exact: true })).toHaveCount(
    0,
  );
  await productInput.press('ArrowDown');
  await expect(workspace.getByRole('region', { name: 'Unit markdown', exact: true })).toHaveCount(
    0,
  );
  await productInput.press('Escape');
  await expect(workspace.getByRole('listbox')).toHaveCount(0);
  await expect(productInput).toHaveValue('');
  await productInput.click();
  await workspace
    .getByRole('listbox')
    .getByRole('option', { name: /Unknown price/ })
    .click();
  await expect(workspace).toContainText('Set a selling price before creating markdown labels.');
  await expect(workspace.getByRole('button', { name: 'Create discounted labels' })).toBeDisabled();
  await productInput.click();
  await expect(workspace.getByRole('listbox').getByRole('option')).toHaveCount(2);
  await productInput.fill('0400000000046');
  await expect(workspace.getByRole('listbox').getByRole('option')).toHaveCount(1);
  await expect(workspace.getByRole('region', { name: 'Unit markdown', exact: true })).toHaveCount(
    0,
  );
  await productInput.press('Enter');
  await expect(productInput).toHaveValue('Yogurt');
  await expect(workspace.getByRole('listbox')).toHaveCount(0);
  const action = workspace.getByRole('region', { name: 'Unit markdown', exact: true });
  await expect(action).toContainText('Available for unit markdown: 10');
  await expect(action).toContainText('60.00');
  await action.getByLabel('Discounted selling price').fill('55');
  await action.getByLabel('Number of units').fill('3');
  const creating = page.waitForResponse(
    (response) =>
      response.url().endsWith('/pricing/limited') && response.request().method() === 'POST',
  );
  await action.getByRole('button', { name: 'Create discounted labels' }).click();
  const result = await (await creating).json();
  expect(result.labels).toHaveLength(3);
  expect(new Set(result.labels.map((label: any) => label.barcode)).size).toBe(3);
  await expect(action).toContainText('Available for unit markdown: 7');
  await page.screenshot({
    path: '/private/tmp/eliza-unit-markdowns-promotions-desktop.png',
    fullPage: true,
  });
  const unchanged = (await (await page.request.get('/api/products')).json()).find(
    (p: any) => p.id === product.id,
  );
  expect(unchanged).toMatchObject({ price: '70.00', stock: '10.000' });
  await action.getByLabel('Discounted selling price').fill('54');
  await action.getByLabel('Number of units').fill('8');
  await expect(action.getByRole('button', { name: 'Create discounted labels' })).toBeDisabled();
  await page.getByRole('tab', { name: 'Product and category promotions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Yogurt offer', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Unit markdowns', exact: true }).click();
  await expect(action.getByLabel('Number of units')).toHaveValue('8');
  const active = action.locator('.price-action-existing', {
    has: page.getByRole('heading', { name: 'Active unit markdown labels' }),
  });
  const firstRow = active.locator('.cash-history-row').first();
  const replacing = page.waitForResponse((response) => response.url().endsWith('/replace'));
  await firstRow.getByRole('button', { name: 'Replace label' }).click();
  const replacement = (await (await replacing).json()).label;
  await expect(active.getByText(replacement.barcode, { exact: true })).toBeVisible();
  await active
    .locator('.cash-history-row')
    .filter({ hasText: replacement.barcode })
    .getByRole('button', { name: 'Cancel label' })
    .click();
  await expect(action).toContainText('Available for unit markdown: 8');
  const unit = (
    await (await page.request.get('/api/products/' + product.id + '/pricing/markdowns')).json()
  ).find((label: any) => label.status === 'AVAILABLE');
  const session = await (await page.request.get('/api/auth/session')).json();
  const roles = await (await page.request.get('/api/team/roles')).json();
  await post(
    '/team/' + session.user.id,
    {
      name: 'Owner',
      employeeCode: 'OWNER',
      roleId: roles.find((r: any) => r.name === 'Owner').id,
      active: true,
      pin: '654321',
    },
    'PATCH',
  );
  const register = await browser.newContext();
  try {
    const registerPage = await register.newPage();
    await post('/auth/login', account, 'POST', registerPage.request);
    await post('/pos/enroll', { name: 'Discount test checkout' }, 'POST', registerPage.request);
    await post(
      '/pos/login',
      { employeeCode: 'OWNER', pin: '654321' },
      'POST',
      registerPage.request,
    );
    const shift = await post(
      '/pos/shifts',
      { requestId: crypto.randomUUID(), openingCash: '0' },
      'POST',
      registerPage.request,
    );
    const lookup = await (
      await registerPage.request.get('/api/pos/products?code=' + unit.barcode)
    ).json();
    expect(lookup).toMatchObject([
      { id: product.id, markdownUnitId: unit.id, price: '55.00', regularPrice: '70.00' },
    ]);
    const sale = await post(
      '/pos/sales',
      {
        requestId: crypto.randomUUID(),
        shiftId: shift.id,
        lines: [
          {
            productId: product.id,
            markdownUnitId: unit.id,
            quantity: '1',
            expectedPrice: '55.00',
            expectedTaxRate: '0.00',
          },
        ],
        discountPercent: '0',
        payment: { method: 'card', tendered: '55' },
      },
      'POST',
      registerPage.request,
    );
    expect(sale).toMatchObject({ subtotal: '70.00', discount: '15.00', total: '55.00' });
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Oslo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const financial = await (
      await page.request.get(
        '/api/reports/financial-summary?' + new URLSearchParams({ from: today, to: today }),
      )
    ).json();
    expect(financial.revenue).toBe('55.00');
    expect(financial.cogs ?? financial.estimated?.cogs).toBe('59.00');
    expect(financial.grossProfit ?? financial.estimated?.grossProfit).toBe('-4.00');
  } finally {
    await register.close();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await productInput.click();
  await expect(workspace.getByRole('listbox').getByRole('option')).toHaveCount(2);
  const dropdown = await workspace.locator('.unit-markdown-dropdown').boundingBox();
  expect(dropdown).not.toBeNull();
  expect(dropdown!.x).toBeGreaterThanOrEqual(0);
  expect(dropdown!.x + dropdown!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/private/tmp/eliza-unit-markdowns-picker-mobile.png' });
  await page.reload();
  await page.getByRole('tab', { name: 'Unit markdowns', exact: true }).click();
  await expect(productInput).toHaveValue('');
  await expect(workspace.getByRole('region', { name: 'Unit markdown', exact: true })).toHaveCount(
    0,
  );
  await productInput.click();
  await expect(workspace.getByRole('listbox').getByRole('option')).toHaveCount(2);
  expect(errors).toEqual([]);
});
