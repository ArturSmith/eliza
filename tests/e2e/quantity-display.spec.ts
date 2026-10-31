import { test, expect } from './fixtures';

test('quantities are readable in Russian receipts, refunds and stock without changing stored decimals', async ({
  page,
  browser,
}) => {
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  const account = { email: 'quantities@example.test', password: 'test-password-12345' };
  async function post(path: string, data: unknown, client = page.request, method = 'POST') {
    const response = await client.fetch('/api' + path, { method, headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  await post('/auth/setup', {
    ...account,
    storeName: 'Quantity shop',
    ownerName: 'Owner',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  });
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
    page.request,
    'PATCH',
  );
  const milk = await post('/products', {
    name: 'Milk',
    sku: 'MILK',
    category: 'Dairy',
    unit: 'piece',
    price: '10',
    cost: '6',
    minStock: '0',
    taxRate: '0',
    barcodes: [],
  });
  const apples = await post('/products', {
    name: 'Apples',
    sku: 'APPLES',
    category: 'Produce',
    unit: 'kilogram',
    price: '20',
    cost: '12',
    minStock: '0',
    taxRate: '0',
    barcodes: [],
  });
  for (const [product, quantity] of [
    [milk, '10'],
    [apples, '5'],
  ] as const) {
    await post('/inventory/adjustments', {
      requestId: crypto.randomUUID(),
      productId: product.id,
      quantity,
      reason: 'opening_balance',
    });
  }
  const register = await browser.newContext();
  try {
    const checkout = await register.newPage();
    await checkout.addInitScript(() => localStorage.setItem('eliza.language', 'ru'));
    await checkout.addLocatorHandler(
      checkout.locator('[data-onboarding-dialog][open]'),
      async (dialog) => {
        await dialog.locator('.page-tour-skip').click();
      },
    );
    await post('/auth/login', account, checkout.request);
    await post('/pos/enroll', { name: 'Quantity checkout' }, checkout.request);
    await post('/pos/login', { employeeCode: 'OWNER', pin: '654321' }, checkout.request);
    const shift = await post(
      '/pos/shifts',
      { requestId: crypto.randomUUID(), openingCash: '100' },
      checkout.request,
    );
    const receipt = await post(
      '/pos/sales',
      {
        requestId: crypto.randomUUID(),
        shiftId: shift.id,
        lines: [
          { productId: milk.id, quantity: '7.000', expectedPrice: '10', expectedTaxRate: '0' },
          { productId: apples.id, quantity: '1.250', expectedPrice: '20', expectedTaxRate: '0' },
        ],
        discountPercent: '0',
        payment: { method: 'cash', tendered: '100' },
      },
      checkout.request,
    );
    expect(receipt.total).toBe('95.00');
    await page.addInitScript(() => localStorage.setItem('eliza.language', 'ru'));
    await page.goto('/sales/receipts/' + receipt.id);
    const lines = page.locator('.receipt-line');
    await expect(lines.filter({ hasText: 'Milk' })).toContainText('7 шт.');
    await expect(lines.filter({ hasText: 'Apples' })).toContainText('1,25 кг');
    await expect(lines).toHaveCount(2);
    await expect(page.locator('.receipt')).not.toContainText('7.000');
    await expect(page.locator('.receipt')).not.toContainText('1.250');
    const stored = await (
      await page.request.get('/api/reports/receipt-search/' + receipt.id)
    ).json();
    expect(stored.receipt.lines.map((l: any) => l.quantity)).toEqual(['7.000', '1.250']);
    await checkout.goto('/pos/receipts/' + receipt.id + '/refund');
    const milkReturn = checkout.locator('.refund-item').filter({ hasText: 'Milk' });
    const applesReturn = checkout.locator('.refund-item').filter({ hasText: 'Apples' });
    await expect(milkReturn).toContainText('Продано: 7 шт.');
    await expect(applesReturn).toContainText('Продано: 1,25 кг');
    await milkReturn.getByRole('textbox').fill('2');
    await applesReturn.getByRole('textbox').fill('0.25');
    await checkout.getByLabel('Причина возврата', { exact: true }).fill('Customer return');
    await milkReturn.getByRole('checkbox').check();
    await applesReturn.getByRole('checkbox').check();
    await checkout
      .getByRole('checkbox', { name: 'Подтверждаю возврат средств за эти товары наличными.' })
      .check();
    const refunded = checkout.waitForResponse(
      (r) => r.url().endsWith('/api/pos/refunds') && r.request().method() === 'POST',
    );
    await checkout.getByRole('button', { name: 'Подтвердить возврат', exact: true }).click();
    const response = await refunded;
    expect(response.ok()).toBe(true);
    expect((await response.json()).total).toBe('25.00');
    const products = await (await page.request.get('/api/products')).json();
    expect(products.find((p: any) => p.id === milk.id).stock).toBe('5.000');
    expect(products.find((p: any) => p.id === apples.id).stock).toBe('4.000');
  } finally {
    await register.close();
  }
});
