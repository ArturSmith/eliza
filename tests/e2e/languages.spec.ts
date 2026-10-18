import { test, expect } from './fixtures';
test.use({ locale: 'ru-RU' });

test('language persists, switches across tabs, and preserves forms and business data', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.locator('#root > .language-bar')).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem('eliza.language', 'en'));
  await page.reload();
  await page.getByLabel('Store name', { exact: true }).fill('Sales');
  await page.getByLabel('Your name', { exact: true }).fill('Cash');
  await page.getByLabel('Email address').fill('language@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  const second = await context.newPage();
  await second.goto('/settings');
  await page.getByRole('button', { name: 'Add product', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Product name', { exact: true }).fill('Cash');
  await dialog.getByLabel('Description (optional)').fill('Original description');
  await dialog.getByLabel('SKU', { exact: true }).fill('LANG-001');
  await dialog.getByLabel('Category', { exact: true }).fill('Sales');
  await dialog.getByLabel('Purchase cost', { exact: true }).fill('15');
  await dialog.getByLabel('Selling price', { exact: true }).fill('30');
  await second.getByLabel('Language', { exact: true }).selectOption('ru');
  await expect(dialog.getByLabel('Название товара', { exact: true })).toHaveValue('Cash');
  await expect(dialog.getByLabel('Описание (необязательно)')).toHaveValue('Original description');
  await expect(dialog.getByLabel('Категория', { exact: true })).toHaveValue('Sales');
  await expect(dialog.getByLabel('Единица измерения', { exact: true })).toHaveValue('piece');
  await dialog.getByRole('button', { name: 'Создать товар', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.getByRole('heading', { name: 'Товары', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Изменить: Cash' })).toBeVisible();
  const products = await page.request.get('/api/products').then((r) => r.json());
  expect(products[0]).toMatchObject({
    name: 'Cash',
    category: 'Sales',
    description: 'Original description',
    unit: 'piece',
    price: '30.00',
  });
  await expect(page.getByRole('button', { name: 'Запасы и закупки', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('russian-products.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#root > .language-bar')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('link', { name: 'Аналитика', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Сводка продаж' })).toBeVisible();
  await page.getByLabel('Группировать продажи по').selectOption('month');
  await expect(page.getByLabel('Группировать продажи по')).toHaveValue('month');
  await page.getByRole('button', { name: 'Применить фильтры' }).click();
  await second.getByLabel('Язык', { exact: true }).selectOption('en');
  await expect(page.getByLabel('Group sales by')).toHaveValue('month');
  await page.goto('/team');
  await page.getByRole('button', { name: 'Edit Cash' }).click();
  await dialog.getByLabel('New PIN (optional)').fill('654321');
  await dialog.getByRole('button', { name: 'Save employee' }).click();
  await expect(dialog).not.toBeVisible();
  const stock = await page.request.post('/api/inventory/adjustments', {
    headers: { 'X-Eliza-Request': '1', Origin: 'http://localhost:5174' },
    data: {
      productId: products[0].id,
      quantity: '10',
      reason: 'opening_balance',
      requestId: crypto.randomUUID(),
    },
  });
  expect(stock.ok(), await stock.text()).toBe(true);
  const enrolled = await page.request.post('/api/pos/enroll', {
    headers: { 'X-Eliza-Request': '1', Origin: 'http://localhost:5174' },
    data: { name: 'Register A' },
  });
  expect(enrolled.ok(), await enrolled.text()).toBe(true);
  await page.goto('/pos');
  await second.getByLabel('Language', { exact: true }).selectOption('ru');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await page.getByLabel('Код сотрудника', { exact: true }).selectOption('OWNER');
  await page.getByLabel('PIN кассира').fill('654321');
  await page.getByRole('button', { name: 'Разблокировать кассу' }).click();
  await page.getByRole('button', { name: 'Открыть смену', exact: true }).click();
  await dialog.getByLabel('Начальная сумма наличных').fill('100');
  await dialog.getByRole('button', { name: 'Открыть смену', exact: true }).click();
  await page.locator('.pos-product').filter({ hasText: 'Cash' }).click();
  await expect(page.locator('.cart-line')).toContainText('Cash');
  await page.getByLabel('Язык', { exact: true }).selectOption('en');
  await expect(page.locator('.cart-line')).toContainText('Cash');
  await page.getByRole('button', { name: 'Take payment', exact: true }).click();
  await dialog.getByLabel('Cash tendered').fill('30');
  // Another tab changes the language while payment details are still being entered.
  await second.getByLabel('Language', { exact: true }).selectOption('ru');
  await expect(dialog.getByLabel('Получено наличными')).toHaveValue('30');
  await dialog.getByRole('button', { name: 'Завершить продажу', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Продажа завершена' })).toBeVisible();
  await expect(dialog.locator('.receipt')).toContainText('Cash');
  await expect(dialog.locator('.receipt')).toContainText('Итого');
  await expect(dialog.locator('.receipt')).toContainText('30,00');
});
