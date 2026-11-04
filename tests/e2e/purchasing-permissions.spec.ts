import { test, expect } from './fixtures';

test('combined navigation retains separate supplier, purchase-writing and delivery permissions', async ({
  page,
}) => {
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  async function post(path: string, data: unknown) {
    const response = await page.request.post('/api' + path, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  await post('/auth/setup', {
    storeName: 'Permission shop',
    ownerName: 'Owner',
    email: 'purchasing-permissions@example.test',
    password: 'test-password-12345',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  });
  const supplier = await post('/suppliers', {
    requestId: crypto.randomUUID(),
    code: 'SUP',
    name: 'Dairy supplier',
  });
  const product = await post('/products', {
    name: 'Milk',
    sku: 'MILK',
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
  // Exercise UI capability combinations while keeping backend authorization covered by integration tests.
  let permissions = ['suppliers.read'];
  await page.route('**/api/auth/session', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, user: { ...body.user, permissions } } });
  });
  await page.goto('/purchases');
  await expect(
    page.getByRole('link', { name: 'Suppliers & purchases', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add supplier', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'All purchase orders', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Open supplier Dairy supplier', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Create order', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Edit supplier', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Purchase history', exact: true })).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Milk', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View Milk', exact: true })).toHaveCount(0);
  await page.goto('/purchases/' + order.id);
  await expect(page.getByText('Access restricted', { exact: true })).toBeVisible();
  permissions = ['purchases.read', 'purchases.receive', 'catalog.read', 'suppliers.read'];
  await page.reload();
  await expect(page.getByRole('link', { name: 'Receive delivery', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Update payment', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Receive delivery', exact: true }).click();
  await expect(page.getByLabel('Unit cost excl. tax', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('New selling price incl. tax (optional)')).toHaveCount(0);
  await page.locator('.delivery-expiry-batch').getByLabel('Quantity', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Record delivery', exact: true }).click();
  await expect(page).toHaveURL('/purchases/' + order.id);
  expect((await (await page.request.get('/api/products')).json())[0].stock).toBe('1.000');
  permissions = ['purchases.read'];
  await page.goto('/purchases');
  await expect(page.getByRole('heading', { name: 'Purchase history', exact: true })).toBeVisible();
  await expect(page.locator('.supplier-directory-filters')).toHaveCount(0);
  await page.goto('/suppliers/' + supplier.id + '/order');
  await expect(page.getByText('Access restricted', { exact: true })).toBeVisible();
});
