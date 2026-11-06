import { test, expect } from './fixtures';
import { storeToday, addDays } from '../../packages/contracts/src/index';

test('a focused daily overview shows canonical metrics, shifts, dates and a responsive chart', async ({
  page,
  playwright,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  const post = async (client: typeof page.request, path: string, data: unknown) => {
    const response = await client.post('/api' + path, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const account = {
    storeName: 'Overview market',
    ownerName: 'Owner',
    email: 'overview@example.test',
    password: 'test-password-12345',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  };
  await post(page.request, '/auth/setup', account);
  const roles = await (await page.request.get('/api/team/roles')).json();
  const roleId = roles.find((r: any) => r.name === 'Cashier').id;
  const product = await post(page.request, '/products', {
    name: 'Yogurt',
    sku: 'YOG',
    category: 'Dairy',
    unit: 'piece',
    price: '30',
    taxRate: '0',
    minStock: '0',
    barcodes: [],
  });
  await post(page.request, '/inventory/adjustments', {
    requestId: crypto.randomUUID(),
    productId: product.id,
    quantity: '100',
    unitCost: '20',
    reason: 'opening_balance',
    notes: 'Known batch cost',
  });
  for (const [index, name, quantity] of [
    [1, 'Anna', '4'],
    [2, 'Ben', '6'],
    [3, 'Cara', '2'],
  ] as const) {
    const employeeCode = 'CASHIER-' + index;
    await post(page.request, '/team', { name, employeeCode, roleId, pin: '123456' });
    const register = await playwright.request.newContext({ baseURL: 'http://localhost:5174' });
    try {
      await post(register, '/auth/login', { email: account.email, password: account.password });
      await post(register, '/pos/enroll', { name: 'Register ' + index });
      await post(register, '/pos/login', { employeeCode, pin: '123456' });
      const shift = await post(register, '/pos/shifts', {
        requestId: crypto.randomUUID(),
        openingCash: '100',
      });
      const amount = String(Number(quantity) * 30);
      await post(register, '/pos/sales', {
        requestId: crypto.randomUUID(),
        shiftId: shift.id,
        lines: [{ productId: product.id, quantity, expectedPrice: '30', expectedTaxRate: '0' }],
        discountPercent: '0',
        payment: { method: 'cash', tendered: amount },
      });
      if (index < 3)
        await post(register, '/pos/shifts/' + shift.id + '/close', {
          requestId: crypto.randomUUID(),
          countedCash: String(100 + Number(amount)),
          notes: 'Day complete',
        });
    } finally {
      await register.dispose();
    }
  }
  const today = storeToday(new Date(), 'Europe/Oslo');
  await post(page.request, '/expenses', {
    date: today,
    description: 'Cleaning',
    category: 'Operations',
    amount: '30',
    paymentMethod: 'bank',
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Store overview', exact: true })).toBeVisible();
  const cards = page.locator('.overview-metric');
  await expect(cards).toHaveCount(4);
  await expect(cards.filter({ hasText: 'Total sales' })).toContainText('360.00');
  await expect(cards.filter({ hasText: 'Gross profit / margin' })).toContainText('120.00');
  await expect(cards.filter({ hasText: 'Gross profit / margin' })).toContainText('33.3%');
  await expect(cards.filter({ hasText: 'Operating profit' })).toContainText('90.00');
  await expect(cards.filter({ hasText: 'Expenses' })).toContainText('30.00');
  await expect(page.getByText('2 completed · 1 open', { exact: true })).toBeVisible();
  await expect(page.locator('.overview-shifts tbody tr')).toHaveCount(3);
  for (const title of [
    'Active products',
    'Inventory value',
    'Your store checklist',
    'Recent activity',
    'Manager Action Center',
  ])
    await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Sales throughout the day', exact: true }),
  ).toBeVisible();
  for (const width of [1440, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width === 1440) {
      const aligned = await page
        .locator('.overview-metric-value')
        .evaluateAll(
          (nodes) =>
            Math.abs(nodes[0].getBoundingClientRect().top - nodes[1].getBoundingClientRect().top) <
            1,
        );
      expect(aligned).toBe(true);
    }
    if (width === 1440 || width === 390)
      await page.screenshot({
        path: test.info().outputPath('overview-' + width + '.png'),
        fullPage: true,
      });
  }
  await page.getByLabel('Overview day', { exact: true }).selectOption('yesterday');
  await expect(cards.filter({ hasText: 'Total sales' })).toContainText('0.00');
  await expect(page.getByText('No shifts for this day.', { exact: true })).toBeVisible();
  await page.getByLabel('Overview day', { exact: true }).selectOption('custom');
  await page.getByLabel('Overview date', { exact: true }).fill(addDays(today, -2));
  await expect(cards.filter({ hasText: 'Total sales' })).toContainText('0.00');
  await page.evaluate(() => localStorage.setItem('eliza.language', 'ru'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Обзор магазина', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Продажи в течение дня', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
