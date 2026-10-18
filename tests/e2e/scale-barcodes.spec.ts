import { test, expect } from './fixtures';
test('scans scale labels into exact kilogram quantities', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('Planning shop');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Email address').fill('shopping@example.test');
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

  const product = await post('/products', {
    name: 'Apples',
    sku: 'APPLES',
    category: 'Fruit',
    unit: 'kilogram',
    price: '30',
    cost: '10',
    taxRate: '0',
    minStock: '0',
    barcodes: [],
    plu: '42',
  });
  await post('/inventory/adjustments', {
    requestId: crypto.randomUUID(),
    productId: product.id,
    quantity: '10',
    reason: 'opening_balance',
  });
  await page.goto('/settings');
  const profile = await (await page.request.get('/api/store-profile')).json();
  await post('/store-profile', {
    ...profile,
    scaleBarcode: { enabled: true, prefix: '20', productDigits: 5, mode: 'weight', decimals: 3 },
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
  const body = '200004201250';
  const barcode =
    body +
    ((10 - ([...body].reduce((sum, d, i) => sum + Number(d) * (i % 2 ? 3 : 1), 0) % 10)) % 10);
  await page.getByLabel('Scan or search products').fill(barcode);
  await page.getByLabel('Scan or search products').press('Enter');
  await expect(page.getByLabel('Quantity for Apples')).toHaveValue('1.250');
  await page.getByLabel('Scan or search products').fill(barcode);
  await page.getByLabel('Scan or search products').press('Enter');
  await expect(page.getByLabel('Quantity for Apples')).toHaveValue('2.500');
  await page
    .getByLabel('Scan or search products')
    .fill(barcode.slice(0, 12) + ((Number(barcode[12]) + 1) % 10));
  await page.getByLabel('Scan or search products').press('Enter');
  await expect(page.getByText('Scale barcode checksum is invalid.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Quantity for Apples')).toHaveValue('2.500');
  expect(errors).toEqual([]);
});
