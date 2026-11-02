import { test, expect } from './fixtures';
import sharp from 'sharp';

test('catalog cards retain search, editing, barcode printing and read-only access on mobile and desktop', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  async function post(path: string, data: unknown) {
    const response = await page.request.post('/api' + path, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  await post('/auth/setup', {
    storeName: 'Catalog shop',
    ownerName: 'Owner',
    email: 'catalog@example.test',
    password: 'test-password-12345',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  });
  const photo =
    'data:image/jpeg;base64,' +
    (
      await sharp({ create: { width: 400, height: 600, channels: 3, background: '#d5e1d0' } })
        .jpeg()
        .toBuffer()
    ).toString('base64');
  const products = [];
  for (const [name, category, price, quantity] of [
    ['Yogurt', 'Dairy', '70', '7'],
    ['Apples', 'Fruit', '30', '1.250'],
    ['Chocolate', 'Sweets', null, '0'],
    [
      'Tea with a very long product name to check how the card wraps on narrow screens',
      'Drinks',
      '50',
      '0',
    ],
  ] as const) {
    const product = await post('/products', {
      name,
      category,
      price,
      cost: name === 'Yogurt' ? '59' : '20',
      image: name === 'Yogurt' ? photo : '',
      unit: name === 'Apples' ? 'kilogram' : 'piece',
      sku: name.split(' ')[0].toUpperCase(),
      description: name === 'Yogurt' ? 'Plain yogurt with live cultures.' : '',
      minStock: '2',
      taxRate: '0',
      barcodes: [],
    });
    products.push(product);
    if (quantity !== '0')
      await post('/inventory/adjustments', {
        requestId: crypto.randomUUID(),
        productId: product.id,
        quantity,
        reason: 'opening_balance',
      });
  }
  for (const [name, packCost, leadTimeDays] of [
    ['Dairy supplier', '590', 1],
    ['Wholesale supplier', '620', 2],
  ] as const) {
    const supplier = await post('/suppliers', {
      requestId: crypto.randomUUID(),
      name,
      code: name.split(' ')[0].toUpperCase(),
    });
    await post('/supplier-products', {
      requestId: crypto.randomUUID(),
      supplierId: supplier.id,
      productId: products[0].id,
      packSize: '10',
      packCost,
      leadTimeDays,
    });
  }
  await page.goto('/products');
  const cards = page.locator('.catalog-card');
  await expect(cards).toHaveCount(4);
  const yogurt = page.getByRole('article', { name: 'Yogurt', exact: true });
  await expect(yogurt).toContainText('Plain yogurt with live cultures.');
  await expect(yogurt).not.toContainText('SKU');
  await expect(yogurt).not.toContainText('On hand');
  await expect(yogurt).not.toContainText('Dairy');
  await expect(page.locator('.catalog-card-menu')).toHaveCount(0);
  const apples = page.getByRole('article', { name: 'Apples', exact: true });
  const chocolate = page.getByRole('article', { name: 'Chocolate', exact: true });
  await expect(apples.locator('.catalog-card-description')).toHaveCount(0);
  await expect(apples.locator('.catalog-card-tag')).toHaveText('Low stock');
  await expect(chocolate.locator('.catalog-card-tag')).toHaveText('Out of stock');
  await expect(yogurt.locator('.catalog-card-tag')).toHaveCount(0);
  const compact = await apples.evaluate((card) => {
    const title = card.querySelector('.catalog-card-name')!.getBoundingClientRect();
    const tag = card.querySelector('.catalog-card-tag')!.getBoundingClientRect();
    const price = card.querySelector('.catalog-card-price')!.getBoundingClientRect();
    return { titleToTag: tag.top - title.bottom, tagToPrice: price.top - tag.bottom };
  });
  expect(compact.titleToTag).toBeLessThan(14);
  expect(compact.tagToPrice).toBeLessThan(14);
  const checkEqualCardHeights = async () => {
    const heights = await cards.evaluateAll((cards) =>
      cards.map((card) => card.getBoundingClientRect().height),
    );
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
  };
  const checkPhotoLayout = async () => {
    const card = await yogurt.boundingBox();
    const photo = await yogurt.locator('.catalog-card-photo').boundingBox();
    const image = await yogurt.locator('.catalog-card-photo img').boundingBox();
    const name = await yogurt.locator('.catalog-card-name').boundingBox();
    expect(Math.abs(photo!.width - (card!.width - 2))).toBeLessThan(1);
    expect(photo!.height / card!.height).toBeGreaterThan(0.4);
    expect(photo!.height / card!.height).toBeLessThan(0.7);
    await expect(yogurt.locator('.catalog-card-photo img')).toHaveCSS('object-fit', 'contain');
    expect(image!.y + image!.height).toBeLessThanOrEqual(photo!.y + photo!.height);
    expect(name!.y).toBeGreaterThanOrEqual(photo!.y + photo!.height);
  };
  await expect(page.getByRole('article', { name: 'Chocolate', exact: true })).toContainText(
    'Not set',
  );
  await yogurt.getByRole('link', { name: 'View Yogurt', exact: true }).click();
  await expect(page).toHaveURL('/products/' + products[0].id);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'General information', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Selling price (optional)', { exact: true })).toHaveValue('70.00');
  await expect(page.locator('.product-details-page')).toContainText('15.71%');
  await expect(page.locator('.product-supplier-card')).toHaveCount(2);
  await expect(page.locator('.product-supplier-card').first()).toContainText('Dairy supplier');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: test.info().outputPath('product-details-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: test.info().outputPath('product-details-mobile.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByRole('button', { name: 'Edit product', exact: true }).click();
  await expect(page).toHaveURL('/products/' + products[0].id);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Product name')).toHaveValue('Yogurt');
  await page.getByLabel('Selling price (optional)', { exact: true }).fill('75');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL('/products/' + products[0].id);
  await expect(page.getByRole('button', { name: 'Edit product', exact: true })).toBeVisible();
  await expect(page.getByLabel('Selling price (optional)', { exact: true })).toHaveValue('75.00');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'General information', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Back to products', exact: true }).click();
  await expect(yogurt.locator('.catalog-card-price')).toContainText('75.00');
  await yogurt.getByRole('button', { name: products[0].barcodes[0], exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Print barcode' })).toBeEnabled();
  await dialog.getByLabel('Close dialog').click();
  await yogurt.getByRole('link', { name: 'View Yogurt', exact: true }).click();
  await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('link', { name: 'Back to products', exact: true }).click();
  const saved = await (await page.request.get('/api/products')).json();
  expect(saved.find((p: any) => p.id === products[0].id).active).toBe(false);
  await page.getByLabel('Search products', { exact: true }).fill(products[1].barcodes[0]);
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('Apples');
  await page.getByLabel('Search products', { exact: true }).fill('');
  await page.getByLabel('Filter category', { exact: true }).selectOption('Fruit');
  await expect(cards).toHaveCount(1);
  await page.getByLabel('Filter category', { exact: true }).selectOption('All categories');
  await expect(cards).toHaveCount(4);
  await page.getByLabel('Stock status', { exact: true }).selectOption('low');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('Apples');
  await page.getByLabel('Stock status', { exact: true }).selectOption('out');
  await expect(cards).toHaveCount(2);
  await page.getByLabel('Stock status', { exact: true }).selectOption('in_stock');
  await expect(cards).toHaveCount(2);
  await page.getByLabel('Product status', { exact: true }).selectOption('active');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('Apples');
  await page.getByLabel('Product status', { exact: true }).selectOption('inactive');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('Yogurt');
  await page.getByLabel('Stock status', { exact: true }).selectOption('out');
  await expect(page.getByText('No matching products', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(cards).toHaveCount(4);
  await page.getByLabel('Sort by', { exact: true }).selectOption('name');
  await expect(page.locator('.catalog-card-name')).toHaveText([
    products[1].name,
    products[2].name,
    products[3].name,
    products[0].name,
  ]);
  await page.getByLabel('Sort by', { exact: true }).selectOption('price_asc');
  await expect(page.locator('.catalog-card-name')).toHaveText([
    products[1].name,
    products[3].name,
    products[0].name,
    products[2].name,
  ]);
  await page.getByLabel('Sort by', { exact: true }).selectOption('price_desc');
  await expect(page.locator('.catalog-card-name')).toHaveText([
    products[0].name,
    products[3].name,
    products[1].name,
    products[2].name,
  ]);
  await page.getByLabel('Sort by', { exact: true }).selectOption('oldest');
  await expect(cards.first()).toContainText('Yogurt');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(cards.first()).toContainText(products[3].name);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await checkEqualCardHeights();
  await checkPhotoLayout();
  await page.screenshot({ path: test.info().outputPath('catalog-desktop.png'), fullPage: true });
  await page.evaluate(() => localStorage.setItem('eliza.language', 'ru'));
  await page.reload();
  await page.getByLabel('Фильтр категории', { exact: true }).selectOption('Fruit');
  await page.getByLabel('Фильтр категории', { exact: true }).selectOption('All categories');
  await expect(cards).toHaveCount(4);
  await page.getByLabel('Наличие', { exact: true }).selectOption('low');
  await expect(cards).toHaveCount(1);
  await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
  await expect(cards).toHaveCount(4);
  for (const width of [900, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await checkPhotoLayout();
    await checkEqualCardHeights();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath('catalog-mobile.png'), fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.screenshot({ path: test.info().outputPath('catalog-dark.png'), fullPage: true });
  const roles = await (await page.request.get('/api/team/roles')).json();
  const staff = { email: 'reader@catalog.test', password: 'reader-password-12345' };
  await post('/team', {
    ...staff,
    name: 'Reader',
    employeeCode: 'READER',
    roleId: roles.find((r: any) => r.name === 'Cashier').id,
    pin: '123456',
  });
  const reader = await browser.newContext();
  try {
    const response = await reader.request.post('http://localhost:5174/api/auth/login', {
      headers,
      data: staff,
    });
    expect(response.ok(), await response.text()).toBe(true);
    const readPage = await reader.newPage();
    await readPage.addLocatorHandler(
      readPage.locator('[data-onboarding-dialog][open]'),
      async (guide) => {
        await guide.locator('.page-tour-skip').click();
      },
    );
    await readPage.goto('/products');
    await expect(readPage.locator('.catalog-card-menu')).toHaveCount(0);
    await readPage.getByRole('link', { name: 'View Apples', exact: true }).click();
    await expect(readPage.getByRole('dialog')).toHaveCount(0);
    await expect(readPage.locator('.product-details-page')).toContainText('Apples');
    await expect(readPage.locator('.product-details-page')).not.toContainText('Purchase cost');
    await expect(readPage.getByRole('button', { name: 'Edit product', exact: true })).toHaveCount(
      0,
    );
    await expect(readPage.locator('.product-details-page')).not.toContainText('Gross margin');
    await expect(readPage.locator('.product-details-suppliers')).toHaveCount(0);
    await expect(readPage.getByRole('button', { name: 'Record stock', exact: true })).toHaveCount(
      0,
    );
    await readPage.goto('/products/' + products[1].id + '/edit');
    await expect(readPage.getByText('Access restricted', { exact: true })).toBeVisible();
    await expect(readPage.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);

    await expect(readPage.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  } finally {
    await reader.close();
  }
  await page.goto('/products/' + crypto.randomUUID());
  await expect(page.getByRole('heading', { name: 'Товар не найден.', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
