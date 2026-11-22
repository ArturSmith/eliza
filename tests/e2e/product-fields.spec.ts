import { test, expect } from './fixtures';

test('saved brands/categories open on focus, and numeric sizes preserve legacy data during edits', async ({
  page,
}) => {
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  async function post(path: string, data: unknown) {
    const response = await page.request.post('/api' + path, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  await post('/auth/setup', {
    storeName: 'Product field shop',
    ownerName: 'Owner',
    email: 'fields@local.test',
    password: 'test-password-12345',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  });
  const base = { unit: 'piece', minStock: '0', price: '15', barcodes: [] };
  await post('/products', {
    ...base,
    name: 'Cola',
    brand: 'Coca-Cola',
    category: 'Drinks',
    sku: 'FIELD-COLA',
    volume: '500 ml',
  });
  const legacy = await post('/products', {
    ...base,
    name: 'Legacy pack',
    brand: 'Tine',
    category: 'Dairy',
    sku: 'FIELD-PACK',
    volume: '24 x 330 ml',
  });
  await page.goto('/products/new');
  const brand = page.getByLabel('Brand (optional)', { exact: true }),
    category = page.getByLabel('Category', { exact: true }),
    amount = page.getByLabel('Volume / size (optional)', { exact: true }),
    unit = page.getByLabel('Size unit', { exact: true });
  await brand.click();
  await expect(page.getByRole('option', { name: 'Coca-Cola', exact: true })).toBeVisible();
  await page.getByRole('option', { name: 'Tine', exact: true }).click();
  await expect(brand).toHaveValue('Tine');
  await brand.click();
  await brand.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await category.click();
  await page.getByRole('option', { name: 'Drinks', exact: true }).click();
  await expect(category).toHaveValue('Drinks');
  await category.click();
  await category.fill('Dai');
  await category.press('ArrowDown');
  await category.press('Enter');
  await expect(category).toHaveValue('Dairy');
  await brand.fill('Fresh brand');
  await expect(
    page.getByText('No matching saved values. You can type a new value.', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Product name', { exact: true }).fill('Next product');
  await page.getByLabel('Unit', { exact: true }).selectOption('piece');
  await amount.fill('abc');
  await expect(amount).toHaveValue('');
  await amount.fill('0');
  await unit.selectOption('kg');
  expect(await amount.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
  await amount.fill('0,');
  await expect(amount).toHaveValue('0,');
  await amount.press('5');
  await expect(amount).toHaveValue('0,5');
  const creation = page.waitForResponse(
    (r) => r.url().endsWith('/api/products') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  const created = await (await creation).json();
  expect(created).toMatchObject({
    brand: 'Fresh brand',
    category: 'Dairy',
    volume: '0.5 kg',
    unit: 'piece',
  });
  await expect(amount).toHaveValue('');
  await expect(unit).toHaveValue('');
  await brand.click();
  await expect(page.getByRole('option', { name: 'Fresh brand', exact: true })).toBeVisible();
  await page.goto('/products/' + legacy.id);
  await expect(
    page.getByText('Existing size: 24 x 330 ml. It will be kept until you replace it.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit product', exact: true }).click();
  await brand.click();
  await page.getByRole('option', { name: 'Coca-Cola', exact: true }).click();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/products/' + legacy.id) && r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(await (await saved).json()).toMatchObject({
    volume: '24 x 330 ml',
    brand: 'Coca-Cola',
    unit: 'piece',
  });
  await page.getByRole('button', { name: 'Edit product', exact: true }).click();
  await amount.fill('250');
  await unit.selectOption('ml');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(amount).toHaveValue('');
  await expect(
    page.getByText('Existing size: 24 x 330 ml. It will be kept until you replace it.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit product', exact: true }).click();
  await amount.fill('250');
  await unit.selectOption('ml');
  const replacement = page.waitForResponse(
    (r) => r.url().endsWith('/api/products/' + legacy.id) && r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(await (await replacement).json()).toMatchObject({ volume: '250 ml', unit: 'piece' });
  await page.goto('/products/new');
  await page.setViewportSize({ width: 390, height: 844 });
  await brand.click();
  await page.screenshot({
    path: '/private/tmp/eliza-product-brand-options-mobile.png',
    fullPage: true,
  });
  await page.getByRole('option', { name: 'Fresh brand', exact: true }).click();
  await category.click();
  await page.getByRole('option', { name: 'Dairy', exact: true }).click();
  await amount.fill('500');
  await unit.selectOption('ml');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: '/private/tmp/eliza-product-size-fields-mobile.png',
    fullPage: true,
  });
  await page.evaluate(() => localStorage.setItem('eliza.language', 'ru'));
  await page.reload();
  await page.getByLabel('Бренд (необязательно)', { exact: true }).click();
  await expect(page.getByRole('option', { name: 'Fresh brand', exact: true })).toBeVisible();
  await expect(
    page.getByLabel('Единица объёма / веса', { exact: true }).locator('option[value="ml"]'),
  ).toHaveText('Миллилитры (мл)');
});
