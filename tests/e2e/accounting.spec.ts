import { test, expect, type APIRequestContext } from './fixtures';
import { storeToday } from '../../packages/contracts/src/index';

test('Accounting owns financial results while Overview and Analytics show operational sales', async ({
  page,
  browser,
  playwright,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  const post = async (client: APIRequestContext, path: string, data: unknown) => {
    const response = await client.post('/api' + path, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const account = {
    storeName: 'Accounting market',
    ownerName: 'Owner',
    email: 'accounting@example.test',
    password: 'test-password-12345',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  };
  await post(page.request, '/auth/setup', account);
  const session = await (await page.request.get('/api/auth/session')).json();
  const roles = await (await page.request.get('/api/team/roles')).json();
  const updated = await page.request.patch('/api/team/' + session.user.id, {
    headers,
    data: {
      name: 'Owner',
      employeeCode: 'OWNER',
      roleId: roles.find((role: any) => role.name === 'Owner').id,
      active: true,
      pin: '123456',
    },
  });
  expect(updated.ok()).toBe(true);
  const product = await post(page.request, '/products', {
    name: 'Yogurt',
    sku: 'YOG',
    category: 'Dairy',
    unit: 'piece',
    price: '100',
    taxRate: '0',
    minStock: '0',
    barcodes: [],
  });
  await post(page.request, '/inventory/adjustments', {
    requestId: crypto.randomUUID(),
    productId: product.id,
    quantity: '10',
    unitCost: '60',
    reason: 'opening_balance',
  });
  const register = await playwright.request.newContext({ baseURL: 'http://localhost:5174' });
  try {
    await post(register, '/auth/login', { email: account.email, password: account.password });
    await post(register, '/pos/enroll', { name: 'Accounting register' });
    await post(register, '/pos/login', { employeeCode: 'OWNER', pin: '123456' });
    const shift = await post(register, '/pos/shifts', {
      requestId: crypto.randomUUID(),
      openingCash: '100',
    });
    const sale = await post(register, '/pos/sales', {
      requestId: crypto.randomUUID(),
      shiftId: shift.id,
      lines: [{ productId: product.id, quantity: '3', expectedPrice: '100', expectedTaxRate: '0' }],
      discountPercent: '0',
      payment: { method: 'cash', tendered: '300' },
    });
    await post(register, '/pos/refunds', {
      requestId: crypto.randomUUID(),
      saleId: sale.id,
      reason: 'Customer return',
      method: 'cash',
      confirmed: true,
      lines: [{ productId: product.id, quantity: '1', restock: true }],
    });
    await post(register, '/pos/shifts/' + shift.id + '/close', {
      requestId: crypto.randomUUID(),
      countedCash: '300',
      notes: 'Balanced drawer',
    });
  } finally {
    await register.dispose();
  }
  await post(page.request, '/inventory/adjustments', {
    requestId: crypto.randomUUID(),
    productId: product.id,
    quantity: '-1',
    reason: 'expired',
  });
  const today = storeToday(new Date(), account.timezone);
  await post(page.request, '/expenses', {
    date: today,
    description: 'Cleaning',
    category: 'Supplies',
    amount: '30',
    paymentMethod: 'bank',
  });
  const canonicalPath =
    '/api/reports/financial-summary?' + new URLSearchParams({ from: today, to: today });
  const canonical = await (await page.request.get(canonicalPath)).json();
  expect(canonical).toMatchObject({
    revenue: '200.00',
    cogs: '120.00',
    grossProfit: '80.00',
    grossMarginPercent: '40.00',
    inventoryLosses: '60.00',
    operatingExpenses: '30.00',
    storeOperatingProfit: '-10.00',
  });

  await page.goto('/');
  const overview = page.locator('.overview-summary');
  await expect(overview.locator('.overview-metric')).toHaveCount(3);
  await expect(overview).toContainText('300.00');
  await expect(overview).not.toContainText(/profit|margin|expenses/i);
  await page.getByRole('link', { name: 'Accounting', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Accounting', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  const financial = page.getByRole('region', { name: 'Store profitability', exact: true });
  for (const [label, value] of [
    ['Revenue', '200.00'],
    ['Cost of goods sold', '120.00'],
    ['Gross profit', '80.00'],
    ['Gross margin', '40.0%'],
    ['Inventory losses', '60.00'],
    ['Operating expenses', '30.00'],
    ['Store operating profit', '10.00'],
  ]) {
    await expect(
      financial
        .locator('.kpi')
        .filter({ has: page.locator('.kpi-label', { hasText: new RegExp('^' + label + '$') }) }),
    ).toContainText(value);
  }
  await expect(
    financial.locator('.kpi').filter({ hasText: 'Store operating profit' }).locator('.kpi-value'),
  ).toHaveText(/^-.*10\.00$/);
  await expect(
    financial.locator('.kpi').filter({ hasText: 'Store operating profit' }),
  ).toHaveAttribute('title', /revenue.*cost of goods sold.*inventory losses.*operating expenses/i);
  await expect(
    page.getByRole('region', { name: 'Expenses by category', exact: true }),
  ).toContainText('30.00');
  await expect(
    page.getByRole('heading', { name: 'Pricing and discounts', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Cash reconciliation', exact: true }),
  ).toBeVisible();
  for (const width of [1440, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width === 1440) {
      const tops = await financial
        .locator('.kpi-value')
        .evaluateAll((nodes) => nodes.slice(0, 4).map((node) => node.getBoundingClientRect().top));
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
    }
    if (width === 1440 || width === 390)
      await page.screenshot({
        path: testInfo.outputPath(`accounting-${width}.png`),
        fullPage: true,
      });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('Product filter').selectOption(product.id);
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(financial.locator('.kpi')).toHaveCount(4);
  await expect(page.locator('.accounting-breakdowns')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Expenses by category', exact: true })).toHaveCount(
    0,
  );
  await page.getByLabel('Product filter').selectOption('');
  await page.getByLabel('From date').fill('2000-01-01');
  await page.getByLabel('To date').fill('2000-01-01');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(financial.locator('.kpi').filter({ hasText: 'Gross margin' })).toContainText(
    'Unavailable',
  );
  await expect(
    financial.locator('.kpi').filter({ has: page.locator('.kpi-label', { hasText: /^Revenue$/ }) }),
  ).toContainText('0.00');
  await expect(
    page.getByRole('heading', { name: 'Pricing and discounts', exact: true }),
  ).toHaveCount(0);
  // All pricing rows use the same explicit dates as the canonical report.
  const emptySources = await page.request.get(
    '/api/reports/pricing-sources?period=custom&from=2000-01-01&to=2000-01-01',
  );
  expect(await emptySources.json()).toEqual([]);

  await page.getByRole('link', { name: 'Analytics', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Product performance', exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Shift performance', exact: true })).toBeVisible();
  await expect(page.locator('.analytics-financial, .analytics-sales-metrics')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(
    /Gross profit|Gross margin|Cost of goods sold|Operating expenses|Paid purchases/,
  );
  await expect(page.getByRole('columnheader', { name: 'Margin', exact: true })).toHaveCount(0);
  await page.getByLabel('Group sales by').selectOption('product');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(
    page.getByRole('columnheader', { name: 'Quantity sold', exact: true }),
  ).toBeVisible();

  await page.goto('/accounting/sales');
  await expect(
    page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Sales', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Sales history', exact: true })).toBeVisible();
  await expect(page.locator('table[aria-label="Recent receipts"] tbody tr')).toHaveCount(1);
  await expect(page.locator('.accounting-sections a[aria-current="page"]')).toHaveCount(1);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`sales-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByRole('button', { name: 'View receipt', exact: true }).click();
  await expect(page).toHaveURL(/\/accounting\/receipts\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Refund history', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to sales', exact: false }).click();
  await expect(page).toHaveURL('/accounting/sales');
  await page.getByRole('button', { name: 'Search all receipts', exact: true }).click();
  const receiptSearch = page.getByRole('dialog', { name: 'Receipt search', exact: true });
  await receiptSearch.getByRole('button', { name: 'Search receipts', exact: true }).click();
  await receiptSearch.getByRole('button', { name: 'Open receipt', exact: true }).click();
  await expect(page).toHaveURL(/\/accounting\/receipts\/[^/]+$/);
  await page.goto('/sales');
  await expect(page).toHaveURL('/accounting/sales');
  await page.getByRole('link', { name: 'Financial summary', exact: true }).click();
  await expect(page).toHaveURL('/accounting');
  await page.evaluate(() => localStorage.setItem('eliza.language', 'ru'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Бухгалтерия', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Финансовая сводка', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Расходы', exact: true })).toBeVisible();
  expect(await (await page.request.get(canonicalPath)).json()).toEqual(canonical);

  // A cashier without sales.read still cannot enter management receipt history or financial reporting.
  await post(page.request, '/team', {
    name: 'Cashier',
    employeeCode: 'CASH',
    roleId: roles.find((role: any) => role.name === 'Cashier').id,
    pin: '654321',
    email: 'limited-accounting@example.test',
    password: 'test-password-12345',
  });
  const limited = await browser.newContext();
  try {
    const limitedPage = await limited.newPage();
    await limitedPage.addLocatorHandler(
      limitedPage.locator('[data-onboarding-dialog][open]'),
      async (dialog) => {
        await dialog.locator('.page-tour-skip').click();
      },
    );
    await post(limitedPage.request, '/auth/login', {
      email: 'limited-accounting@example.test',
      password: 'test-password-12345',
    });
    await limitedPage.goto('/accounting');
    await expect(limitedPage.getByText('Access restricted', { exact: true })).toBeVisible();
    await expect(limitedPage.getByRole('link', { name: 'Accounting', exact: true })).toHaveCount(0);
    await expect(
      limitedPage.getByRole('link', { name: 'Financial summary', exact: true }),
    ).toHaveCount(0);
    await expect(limitedPage.locator('.analytics-financial')).toHaveCount(0);
    expect((await limitedPage.request.get(canonicalPath)).status()).toBe(403);
  } finally {
    await limited.close();
  }
  expect(errors).toEqual([]);
});
