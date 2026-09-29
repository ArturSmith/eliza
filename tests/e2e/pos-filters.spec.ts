import { test, expect } from '@playwright/test';
test('filters, favorites and paginates the checkout catalog', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('Planning shop');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Email address').fill('checkout-filters@example.test');
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

  for (let i = 0; i < 25; i++) {
    const product = await post('/products', {
      name: 'Product ' + String(i).padStart(2, '0'),
      sku: 'PRODUCT-' + i,
      category: i < 10 ? 'Drinks' : 'Food',
      unit: 'piece',
      price: '2',
      cost: '1',
      taxRate: '0',
      minStock: '0',
      barcodes: ['BAR' + i],
    });
    await post('/inventory/adjustments', {
      requestId: crypto.randomUUID(),
      productId: product.id,
      quantity: i === 24 ? '2' : '10',
      reason: 'opening_balance',
    });
  }
  await post('/products', {
    name: 'Unavailable',
    sku: 'EMPTY',
    category: 'Food',
    unit: 'piece',
    price: '2',
    cost: '1',
    taxRate: '0',
    minStock: '0',
    barcodes: [],
  });
  const inactive = await post('/products', {
    name: 'Inactive product',
    sku: 'INACTIVE',
    category: 'Food',
    unit: 'piece',
    price: '2',
    cost: '1',
    taxRate: '0',
    minStock: '0',
    barcodes: ['INACTIVE-CODE'],
  });
  const deactivated = await page.request.patch('/api/products/' + inactive.id + '/status', {
    headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
    data: { active: false },
  });
  expect(deactivated.ok(), await deactivated.text()).toBe(true);
  const session = await (await page.request.get('/api/auth/session')).json();
  const roles = await (await page.request.get('/api/team/roles')).json();
  const edited = await page.request.patch('/api/team/' + session.user.id, {
    headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
    data: {
      name: 'Alex',
      employeeCode: 'OWNER',
      roleId: roles.find((r: any) => r.name === 'Owner').id,
      active: true,
      pin: '654321',
    },
  });
  expect(edited.ok(), await edited.text()).toBe(true);
  await post('/pos/enroll', { name: 'Scale checkout' });
  await post('/pos/login', { employeeCode: 'OWNER', pin: '654321' });
  await post('/pos/shifts', { openingCash: '0', requestId: crypto.randomUUID() });
  await page.goto('/pos');
  await expect(page.getByLabel('Scan or search products')).toBeFocused();
  await expect(page.locator('#root > .language-bar')).toBeHidden();
  await expect(page.locator('.pos-footer .language-switcher')).toBeVisible();

  await expect(page.locator('.pos-product-card')).toHaveCount(20);
  const desktopLayout = await page.evaluate(() => ({
    pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
    productsScroll:
      document.querySelector('.pos-product-scroll')!.scrollHeight >
      document.querySelector('.pos-product-scroll')!.clientHeight,
    paymentVisible: !!document.querySelector('.pay-button')?.getBoundingClientRect().height,
  }));
  expect(desktopLayout.pageScrolls).toBe(false);
  expect(desktopLayout.productsScroll).toBe(true);
  expect(desktopLayout.paymentVisible).toBe(true);
  await expect(page.getByText('Unavailable', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.pos-product-card')).toHaveCount(5);
  await page.getByRole('button', { name: 'Add Product 24 to favorites', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove Product 24 from favorites', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await expect(page.locator('.pos-product-card')).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel('Scan or search products')).toBeFocused();
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await expect(page.locator('.pos-product-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'All products', exact: true }).click();
  await page.getByRole('button', { name: 'Drinks', exact: true }).click();
  await expect(page.locator('.pos-product-card')).toHaveCount(10);
  await page.getByRole('button', { name: 'All products', exact: true }).click();
  await page.getByLabel('Scan or search products').fill('BAR24');
  await page.getByLabel('Scan or search products').press('Enter');
  await expect(page.getByLabel('Quantity for Product 24')).toHaveValue('1');
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(
      '[aria-label="Scan or search products"]',
    );
    if (!input) throw new Error('Checkout barcode input missing');
    // Simulate a scanner submitting while its last input has not reached React state.
    input.value = 'BAR24';
    input.closest('form')?.requestSubmit();
  });
  await expect(page.getByLabel('Quantity for Product 24')).toHaveValue('2.000');
  await page.getByLabel('Scan or search products').fill('BAR24');
  await page.getByLabel('Scan or search products').press('Enter');
  await expect(page.getByRole('alert')).toContainText('Not enough stock for Product 24.');
  await expect(page.getByLabel('Quantity for Product 24')).toHaveValue('2.000');
  await page.getByLabel('Scan or search products').fill('Product 24');
  await page
    .locator('.pos-product-card')
    .filter({ hasText: 'Product 24' })
    .locator('.pos-product')
    .click();
  await expect(page.getByRole('alert')).toContainText('Not enough stock for Product 24.');
  await expect(page.getByLabel('Quantity for Product 24')).toHaveValue('2.000');
  await page.getByLabel('Quantity for Product 24').fill('3');
  await page.getByLabel('Quantity for Product 24').blur();
  await expect(page.getByLabel('Quantity for Product 24')).toHaveValue('2.000');
  await expect(page.getByRole('alert')).toContainText('Not enough stock for Product 24.');
  await page.getByLabel('Scan or search products').fill('EMPTY');
  await page.getByLabel('Scan or search products').press('Enter');
  await expect(page.getByRole('alert')).toContainText('Out of stock: Unavailable');
  await expect(page.getByLabel('Scan or search products')).toHaveValue('');
  await expect(page.getByLabel('Quantity for Product 24')).toHaveValue('2.000');
  await page.getByLabel('Scan or search products').fill('INACTIVE-CODE');
  await page.getByLabel('Scan or search products').press('Enter');
  await expect(page.getByRole('alert')).toContainText('This product is unavailable for sale.');
  await expect(page.getByLabel('Scan or search products')).toHaveValue('');
  await page.getByLabel('Scan or search products').fill('NOT-FOUND');
  await page.getByLabel('Scan or search products').press('Enter');
  await expect(page.getByRole('alert')).toContainText('Barcode not registered.');
  await expect(page.getByLabel('Scan or search products')).toHaveValue('');
  await expect(page.locator('.pos-product-card')).toHaveCount(20);
  await page.screenshot({ path: 'test-results/checkout-filters-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Favorites', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 1),
  ).toBe(false);
  await expect(page.locator('.pos-product-card').first()).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Take payment' })).toBeInViewport();
  await page.screenshot({ path: 'test-results/checkout-filters-mobile.png', fullPage: true });
  for (let i = 0; i < 8; i++) {
    await page.getByLabel('Scan or search products').fill('BAR' + i);
    await page.getByLabel('Scan or search products').press('Enter');
    await expect(
      page.getByLabel('Quantity for Product ' + String(i).padStart(2, '0')),
    ).toBeVisible();
  }
  expect(
    await page.evaluate(() => {
      const cart = document.querySelector('.cart-lines')!;
      return cart.scrollHeight > cart.clientHeight;
    }),
  ).toBe(true);
  await expect(page.getByRole('button', { name: 'Take payment' })).toBeInViewport();
  expect(errors).toEqual([]);
});
