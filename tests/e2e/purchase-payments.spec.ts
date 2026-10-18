import { test, expect } from './fixtures';
test('receiving and payment statuses stay independent and payment filters persist correctly', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('Payment shop');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Email address').fill('payments@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await expect(page.getByRole('link', { name: 'Purchases', exact: true })).toBeVisible();
  async function post(path: string, data: unknown) {
    const r = await page.request.post('/api' + path, {
      headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
      data,
    });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  }
  const supplier = await post('/suppliers', {
    requestId: crypto.randomUUID(),
    code: 'PAY',
    name: 'Supplier',
  });
  const product = await post('/products', {
    name: 'Milk',
    sku: 'PAY-MILK',
    category: 'Dairy',
    unit: 'piece',
    price: '10',
    cost: '5',
    taxRate: '0',
    minStock: '0',
    barcodes: [],
  });
  let order = await post('/purchases', {
    requestId: crypto.randomUUID(),
    supplierId: supplier.id,
    lines: [{ productId: product.id, quantity: '2', unitCost: '5', taxRate: '0' }],
  });
  order = await post('/purchases/' + order.id + '/status', {
    requestId: crypto.randomUUID(),
    version: order.version,
    status: 'ordered',
  });
  await page.goto('/purchases');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const payment = page.locator('.order-payment');
  await payment.getByRole('button', { name: 'Update payment' }).click();
  await page.getByRole('dialog').getByLabel('Payment due date').fill('2000-01-01');
  await page.getByRole('dialog').getByRole('button', { name: 'Save payment status' }).click();
  await expect(payment.getByText('Overdue', { exact: true })).toBeVisible();
  order = await page.request.get('/api/purchases/' + order.id).then((r) => r.json());
  await post('/purchases/' + order.id + '/receipts', {
    requestId: crypto.randomUUID(),
    version: order.version,
    lines: [{ purchaseLineId: order.lines[0].id, quantity: '2', unitCost: '5' }],
  });
  await page.reload();
  await page.locator('.table-toolbar').getByLabel('Payment status').selectOption('overdue');
  await expect(page.getByRole('cell', { name: 'received', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await payment.getByRole('button', { name: 'Update payment' }).click();
  await page.getByRole('dialog').getByLabel('Payment status', { exact: true }).selectOption('paid');
  await page.getByRole('dialog').getByRole('button', { name: 'Save payment status' }).click();
  await expect(payment.locator('.badge').filter({ hasText: /^Paid$/ })).toBeVisible();
  await page.locator('.table-toolbar').getByLabel('Payment status').selectOption('paid');
  await expect(page.getByRole('cell', { name: 'received', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('cell', { name: /Paid/ })).toBeVisible();
  const languageSettings = await page.context().newPage();
  await languageSettings.goto('/settings');
  await languageSettings.getByLabel('Language', { exact: true }).selectOption('ru');
  await languageSettings.close();
  await expect(page.getByRole('cell', { name: /Оплачен/ })).toBeVisible();
});
