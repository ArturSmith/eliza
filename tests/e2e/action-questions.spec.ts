import { test, expect, enableAdvancedFeatures } from './fixtures';
import { actionQuestions } from '../../packages/contracts/src/index';

test('manager questions show evidence, actions, separate periods and Russian labels on narrow screens', async ({
  page,
}) => {
  const setup = await page.request.post('/api/auth/setup', {
    headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
    data: {
      storeName: 'Question shop',
      ownerName: 'Owner',
      email: 'questions-ui@local.test',
      password: 'test-password-12345',
      currency: 'NOK',
      timezone: 'Europe/Oslo',
    },
  });
  expect(setup.ok()).toBe(true);
  await page.goto('/');
  await enableAdvancedFeatures(page);
  const product = '00000000-0000-4000-8000-000000000001';
  const row = {
    productId: product,
    name: 'Cola',
    volume: '500 ml',
    sku: 'COLA',
    unit: 'piece',
    available: '8',
    incoming: '0',
    sold: '56',
    observedDays: 28,
    supplierId: product,
    supplierName: 'Supplier A',
    leadDays: 5,
    status: 'order_now',
    demandStatus: 'selling',
    dailySales: '2',
    daysOfStock: 4,
    quantity: '24',
    orderBy: '2026-11-21',
    targetStock: '28',
    warnings: ['stockout_history'],
  };
  const report = {
    today: '2026-11-21',
    timezone: 'Europe/Oslo',
    currency: 'NOK',
    generatedAt: '2026-11-21T12:00:00Z',
    period: 'week',
    range: { from: '2026-11-14', to: '2026-11-20' },
    comparison: { from: '2026-11-07', to: '2026-11-13' },
    planning: {
      allowed: true,
      total: 1,
      orderNow: 1,
      needsReview: 1,
      insufficientHistory: 2,
      truncated: false,
      rows: [row],
    },
    expiry: {
      allowed: true,
      total: 1,
      unknownProducts: 2,
      rows: [
        {
          id: product,
          productId: product,
          name: 'Yogurt',
          volume: '200 g',
          unit: 'piece',
          quantity: '12',
          expiryDate: '2026-11-23',
          supplierName: 'Supplier A',
          expired: false,
        },
      ],
    },
    overstock: {
      allowed: true,
      total: 1,
      truncated: false,
      rows: [
        {
          ...row,
          name: 'Tea',
          demandStatus: 'no_sales',
          status: 'no_demand',
          dailySales: '0',
          daysOfStock: null,
          quantity: '0',
          available: '25',
        },
      ],
    },
    costs: {
      allowed: true,
      total: 1,
      rows: [
        {
          productId: product,
          name: 'Cola',
          volume: '500 ml',
          unit: 'piece',
          supplierName: 'Supplier A',
          paidAt: '2026-11-20T12:00:00Z',
          cost: '12',
          previousCost: '10',
          change: '20',
          alternativeSupplier: 'Supplier B',
          alternativeCost: '9',
          alternativeDate: '2026-11-17T12:00:00Z',
        },
      ],
    },
    demand: {
      allowed: true,
      receipts: 45,
      previousReceipts: 30,
      rows: [
        {
          productId: product,
          name: 'Cola',
          volume: '500 ml',
          unit: 'piece',
          quantity: '56',
          previousQuantity: '40',
          change: '16',
        },
      ],
    },
    assortment: {
      allowed: true,
      incomplete: 1,
      rows: [
        {
          productId: product,
          name: 'Cola',
          volume: '500 ml',
          unit: 'piece',
          quantity: '56',
          grossProfit: '560',
          revenue: '1120',
        },
      ],
    },
  };
  const periods: string[] = [];
  await page.route('**/api/reports/action-center/questions*', (route) => {
    const period = new URL(route.request().url()).searchParams.get('period')!;
    periods.push(period);
    return route.fulfill({ json: { ...report, period } });
  });
  await page.goto('/action-center');
  for (const [, title] of actionQuestions)
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.locator('.question-section')).toHaveCount(6);
  const order = page.locator('#question-order');
  await expect(order).toContainText('24 piece');
  await expect(order).toContainText('Supplier A');
  await expect(order.getByRole('link', { name: 'Review order recommendations' })).toHaveAttribute(
    'href',
    '/replenishment',
  );
  await expect(page.locator('#question-expiry')).toContainText('12 piece');
  await expect(page.locator('#question-costs')).toContainText('Supplier B');
  await expect(page.locator('#question-demand')).toContainText('Completed receipts: 45');
  await expect(page.locator('#question-assortment')).toContainText('560.00');
  await expect(page.getByRole('button', { name: 'Mark seen' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Last 28 complete days', exact: true }).click();
  await expect.poll(() => periods.at(-1)).toBe('month');
  await expect(page.locator('#question-order')).toBeVisible();
  await page.screenshot({
    path: '/private/tmp/eliza-action-questions-desktop.png',
    fullPage: true,
  });
  await page
    .locator('#question-overstock')
    .getByRole('button', { name: 'Analyse no-sales stock' })
    .click();
  await expect(page.getByRole('heading', { name: 'Products without sales' })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('eliza.language', 'ru'));
  await page.reload();
  const russian = [
    'Что, сколько и когда заказать?',
    'Что мы не успеем продать?',
    'Что пока не стоит заказывать?',
    'Последняя поставка стала дороже? У какого поставщика мы покупали выгоднее?',
    'Что стало продаваться лучше или хуже?',
    'Какие товары действительно полезны магазину?',
  ];
  for (const title of russian)
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/private/tmp/eliza-action-questions-mobile.png', fullPage: true });
  await page.route('**/api/reports/action-center/questions*', (route) =>
    route.fulfill({
      json: {
        ...report,
        planning: { ...report.planning, allowed: false, rows: [] },
        expiry: { ...report.expiry, allowed: false, rows: [] },
        overstock: { ...report.overstock, allowed: false, rows: [] },
        costs: { ...report.costs, allowed: false, rows: [] },
        demand: { ...report.demand, allowed: false, rows: [] },
        assortment: { ...report.assortment, allowed: false, rows: [] },
      },
    }),
  );
  await page.reload();
  await expect(page.locator('.question-section')).toHaveCount(6);
  await expect(
    page.getByText('Для этой секции нужны дополнительные права на просмотр отчётов.', {
      exact: true,
    }),
  ).toHaveCount(6);
  await expect(page.getByText('Supplier A', { exact: true })).toHaveCount(0);
});
