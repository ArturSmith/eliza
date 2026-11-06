import { test, expect } from './fixtures';

test('supplier product search reuses the catalog and creates missing products already linked', async ({
  page,
}) => {
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post('/api' + path, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  await post('/auth/setup', {
    storeName: 'Supplier search shop',
    ownerName: 'Owner',
    email: 'supplier-search@example.test',
    password: 'test-password-12345',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  });
  const supplier = await post('/suppliers', {
    requestId: crypto.randomUUID(),
    code: 'DAIRY',
    name: 'Dairy supplier',
  });
  const product = await post('/products', {
    name: 'Plain yogurt',
    sku: 'YOG-1',
    category: 'Dairy',
    unit: 'piece',
    minStock: '0',
    price: '12',
    cost: '8',
    plu: '101',
    barcodes: ['5901234123457'],
  });
  const url = `/suppliers/${supplier.id}/products/new`;
  await page.goto(`/suppliers/${supplier.id}`);
  await page.getByRole('link', { name: 'Add product', exact: true }).click();
  await expect(page).toHaveURL(url);
  await expect(page.getByLabel('Price per pack')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Nothing found — create new product', exact: true }),
  ).toHaveCount(0);
  const search = page.getByRole('searchbox', { name: 'Find a product', exact: true });
  const result = page.getByRole('button', { name: 'Add Plain yogurt to supplier', exact: true });
  const create = page.getByRole('button', { name: 'Create new product', exact: true });
  await create.click();
  await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(search).toHaveValue('');

  for (const term of ['yogurt', 'YOG-1', '101', '5901234123457']) {
    await search.fill(term);
    await expect(result).toBeVisible();
    await expect(create).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Nothing found — create new product', exact: true }),
    ).toHaveCount(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: test.info().outputPath('supplier-product-search-mobile.png'),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await result.click();
  await expect(page).toHaveURL(`/suppliers/${supplier.id}`);
  await expect(page.getByRole('article', { name: 'Plain yogurt', exact: true })).toContainText(
    'No deliveries recorded yet.',
  );
  expect(await (await page.request.get('/api/products')).json()).toHaveLength(1);
  await page.goto(url);
  await search.fill('yogurt');
  await expect(result).toBeDisabled();
  await expect(page.getByText('Already added to this supplier')).toBeVisible();
  await search.fill('5901234123464');
  await create.click();
  await expect(page.getByLabel('Barcodes (optional)')).toHaveValue('5901234123464');
  await page.getByLabel('Product name', { exact: true }).fill('New strawberry yogurt');
  await page.getByLabel('Category', { exact: true }).fill('Dairy');
  await page.getByRole('button', { name: 'Create product', exact: true }).click();
  await expect(page).toHaveURL(`/suppliers/${supplier.id}`);
  await expect(
    page.getByRole('article', { name: 'New strawberry yogurt', exact: true }),
  ).toBeVisible();
  const catalog = await (await page.request.get(`/api/suppliers/${supplier.id}/products`)).json();
  const allProducts = await (await page.request.get('/api/products')).json();
  expect(catalog).toHaveLength(2);
  expect(allProducts).toHaveLength(2);
  expect(catalog.every((item: any) => item.packCost === null && item.unitCost === null)).toBe(true);
  expect(allProducts.find((p: any) => p.id === product.id)).toMatchObject({
    price: '12.00',
    cost: '8.00',
    stock: '0.000',
  });
  await page.goto(url);
  await search.fill('Missing cheese');
  await page
    .getByRole('button', { name: 'Nothing found — create new product', exact: true })
    .click();
  await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('Missing cheese');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(search).toHaveValue('Missing cheese');
  // A failed catalog request must not be mistaken for "no matches".
  await page.route('**/api/products', (route) =>
    route.fulfill({ status: 503, json: { message: 'Catalog unavailable' } }),
  );
  await page.reload();
  await search.fill('Missing cheese');
  await expect(page.getByRole('alert')).toContainText('Catalog unavailable');
  await expect(
    page.getByRole('button', { name: 'Nothing found — create new product', exact: true }),
  ).toHaveCount(0);
});
