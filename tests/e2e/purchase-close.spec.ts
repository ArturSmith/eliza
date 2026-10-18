import { test, expect } from './fixtures';
test('closes a partial purchase without changing delivered quantities', async ({ page }) => {
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
  const supplier = await post('/suppliers', {
    requestId: crypto.randomUUID(),
    code: 'CLOSE',
    name: 'Test supplier',
    phone: '+7 (969) 722-22-22',
    contactName: 'M-7 S. Mokhamad',
    contactPhone: '89292088095',
  });
  expect(supplier.contactPhone).toBe('89292088095');
  const product = await post('/products', {
    name: 'Milk',
    sku: 'CLOSE',
    category: 'Dairy',
    unit: 'piece',
    price: '10',
    cost: '5',
    minStock: '0',
    barcodes: [],
    plu: '',
  });
  let order = await post('/purchases', {
    requestId: crypto.randomUUID(),
    supplierId: supplier.id,
    buyerName: 'Chir-kort',
    buyerDetails: '13 Mag Rimis Street',
    driverName: 'Saliev',
    driverPhone: '89381127025',
    goodsNumber: 'G-17',
    buyerTaxNumber: '1234567890',
    grossWeight: '55.304 kg',
    documentVat: '1557.66',
    returnAmount: '0',
    documentComment: 'Checked on arrival',
    lines: [{ productId: product.id, quantity: '10', unitCost: '5', taxRate: '0' }],
  });
  expect(order.buyer_name).toBe('Chir-kort');
  expect(order.driver_phone).toBe('89381127025');
  order = await post('/purchases/' + order.id + '/status', {
    requestId: crypto.randomUUID(),
    version: order.version,
    status: 'ordered',
  });
  order = await post('/purchases/' + order.id + '/receipts', {
    requestId: crypto.randomUUID(),
    version: order.version,
    lines: [{ purchaseLineId: order.lines[0].id, quantity: '3' }],
  });
  await page.goto('/purchases?order=' + order.id);
  await expect(page.getByText('Chir-kort')).toBeVisible();
  await expect(page.getByText('89381127025')).toBeVisible();
  await expect(page.getByText('89292088095')).toBeVisible();
  await expect(page.getByText('+7 (969) 722-22-22')).toBeVisible();
  await page.getByRole('button', { name: 'Close remaining quantities', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Milk: 7 piece')).toBeVisible();
  await dialog.getByLabel('Closure reason').fill('Supplier cannot deliver the rest');
  await dialog.getByRole('button', { name: 'Confirm closure', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Remaining quantities closed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Receive delivery', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('columnheader', { name: 'Closed quantity', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText('Supplier cannot deliver the rest', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
