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
      quantity: '10',
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

  await expect(page.locator('.pos-product-card')).toHaveCount(20);
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
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await expect(page.locator('.pos-product-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'All products', exact: true }).click();
  await page.getByRole('button', { name: 'Drinks', exact: true }).click();
  await expect(page.locator('.pos-product-card')).toHaveCount(10);
  await page.getByRole('button', { name: 'All products', exact: true }).click();
  await page.getByLabel('Scan or search products').fill('BAR24');
  await page.getByLabel('Scan or search products').press('Enter');
  await expect(page.getByLabel('Quantity for Product 24')).toHaveValue('1');
  await expect(page.locator('.pos-product-card')).toHaveCount(20);
  await page.screenshot({ path: 'test-results/checkout-filters-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Favorites', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/checkout-filters-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
