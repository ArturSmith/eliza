import { test, expect } from './fixtures';

test('recurring deliveries can be configured, received and safely retried on desktop, mobile and the register', async ({
  page,
  browser,
}) => {
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  async function post(path: string, data: unknown) {
    const r = await page.request.post('/api' + path, { headers, data });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  }
  await post('/auth/setup', {
    storeName: 'Fresh shop',
    ownerName: 'Owner',
    email: 'quick-ui@local.test',
    password: 'test-password-12345',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  });
  const supplier = await post('/suppliers', {
    requestId: crypto.randomUUID(),
    code: 'BAKER',
    name: 'Morning bakery',
  });
  const product = await post('/products', {
    name: 'Bread',
    sku: 'QUICK-BREAD',
    unit: 'piece',
    category: 'Bakery',
    price: '8',
    minStock: '0',
    barcodes: ['1234567890123'],
  });
  await page.goto('/purchases');
  await page.getByRole('link', { name: 'Add shortcut', exact: true }).click();
  await page.getByLabel('Shortcut name', { exact: true }).fill('Fresh bread');
  await page.getByRole('button', { name: 'Search suppliers', exact: true }).click();
  await page.getByRole('option', { name: 'Morning bakery', exact: true }).click();
  await page.getByRole('button', { name: 'Search by name, SKU or barcode', exact: true }).click();
  await page.getByPlaceholder('Search…', { exact: true }).fill('1234567890123');
  await page.getByRole('option', { name: /Bread/ }).click();
  await page.getByLabel('Purchase tax %', { exact: true }).fill('15');
  await page.getByRole('button', { name: 'Save shortcut', exact: true }).click();
  await expect(page.getByText('Shortcut saved.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to purchases', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Fresh bread', exact: true })).toBeVisible();
  await page.screenshot({ path: '/private/tmp/eliza-quick-receiving-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Receive delivery', exact: true }).click();
  const quantity = page.getByLabel('Quantity', { exact: true }),
    cost = page.getByLabel('Actual unit cost excl. tax', { exact: true });
  await expect(quantity).toHaveValue('');
  await expect(cost).toHaveValue('');
  await quantity.fill('100');
  await cost.fill('2.50');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByText('287,5 NOK', { exact: true }).or(page.getByText('287.5 NOK', { exact: true })),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/private/tmp/eliza-quick-receiving-mobile.png', fullPage: true });
  let first = true;
  await page.route('**/api/quick-receipts/*/receive', async (route) => {
    if (first) {
      first = false;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Confirm delivery', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry receipt', exact: true })).toBeVisible();
  await expect(quantity).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Retry receipt', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry receipt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Delivery received', exact: true })).toBeVisible();
  expect(
    (await (await page.request.get('/api/products')).json()).find((p: any) => p.id === product.id)
      .stock,
  ).toBe('100.000');
  await page.getByRole('button', { name: 'Receive another delivery', exact: true }).click();
  await expect(quantity).toHaveValue('');
  await expect(cost).toHaveValue('');
  const roles = await (await page.request.get('/api/team/roles')).json();
  const cashier = roles.find((r: any) => r.name === 'Cashier'),
    receiver = roles.find((r: any) => r.name === 'Receiving clerk');
  await post('/team', {
    name: 'Receiver',
    employeeCode: 'RECEIVER',
    pin: '123456',
    roleId: cashier.id,
    roleIds: [cashier.id, receiver.id],
  });
  const register = await browser.newContext({
    baseURL: 'http://localhost:5174',
    viewport: { width: 1280, height: 900 },
  });
  const p = await register.newPage();
  try {
    const auth = await register.request.post('http://localhost:5174/api/auth/login', {
      headers,
      data: { email: 'quick-ui@local.test', password: 'test-password-12345' },
    });
    expect(auth.ok()).toBe(true);
    expect(
      (
        await register.request.post('http://localhost:5174/api/pos/enroll', {
          headers,
          data: { name: 'Front register' },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await register.request.post('http://localhost:5174/api/pos/login', {
          headers,
          data: { employeeCode: 'RECEIVER', pin: '123456' },
        })
      ).ok(),
    ).toBe(true);
    await p.goto('/pos');
    await expect(p.getByRole('button', { name: 'Quick receiving', exact: true })).toHaveCount(0);
    expect(
      (
        await register.request.post('http://localhost:5174/api/pos/shifts', {
          headers,
          data: { requestId: crypto.randomUUID(), openingCash: '100' },
        })
      ).ok(),
    ).toBe(true);
    await p.reload();
    await p.locator('.pos-product').filter({ hasText: 'Bread' }).click();
    await expect(p.locator('.pos-cart')).toContainText('Bread');
    await p.getByRole('button', { name: 'Quick receiving', exact: true }).click();
    await p.getByRole('button', { name: 'Receive delivery', exact: true }).click();
    await p.getByLabel('Quantity', { exact: true }).fill('20');
    await p.getByLabel('Actual unit cost excl. tax', { exact: true }).fill('3');
    await p.screenshot({ path: '/private/tmp/eliza-quick-receiving-pos.png', fullPage: true });
    await p.getByRole('button', { name: 'Confirm delivery', exact: true }).click();
    await expect(p.getByRole('heading', { name: 'Delivery received', exact: true })).toBeVisible();
    const list = await (await page.request.get('/api/products')).json();
    expect(list.find((v: any) => v.id === product.id).stock).toBe('120.000');
    await p.getByRole('button', { name: 'Back', exact: true }).click();
    await p.getByRole('button', { name: 'Back to checkout', exact: true }).click();
    await expect(p.getByRole('button', { name: 'Quick receiving', exact: true })).toBeVisible();
    await expect(p.locator('.pos-cart')).toContainText('Bread');
  } finally {
    await register.close();
  }
  await page.goto('/purchases');
  await page.getByRole('link', { name: 'Edit Fresh bread', exact: true }).click();
  await page.getByLabel('Active shortcut', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save shortcut', exact: true }).click();
  await expect(page.getByText('Shortcut saved.', { exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('eliza.language', 'ru'));
  await page.goto('/purchases');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Быстрая приёмка', exact: true })).toBeVisible();
});
