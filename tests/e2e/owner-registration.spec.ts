import { test, expect, type Page } from './fixtures';

// Run with ALLOW_REGISTRATION=true against the disposable E2E database.
const password = 'independent-owner-password-12345';
async function register(page: Page, store: string, email: string) {
  await page.getByLabel('Store name', { exact: true }).fill(store);
  await page.getByLabel('Your name').fill(store + ' owner');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await expect(page.getByLabel('Setup token', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Create my store', exact: true }).click();
}

test('owners register independent stores and switch accounts without leaking catalog data', async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.ALLOW_REGISTRATION !== 'true',
    'This scenario requires opt-in registration.',
  );
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: 'Let’s open your store' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('registration-desktop.png'), fullPage: true });
  await register(page, 'First independent store', 'first@signup.test');
  await expect(page.getByRole('heading', { name: 'Store overview' })).toBeVisible();
  const first = await (await page.request.get('/api/auth/session')).json();
  const product = await page.request.post('/api/products', {
    headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
    data: {
      name: 'First store yogurt',
      sku: 'FIRST-YOG',
      category: 'Dairy',
      unit: 'piece',
      price: '100',
      taxRate: '0',
      minStock: '0',
      barcodes: [],
    },
  });
  expect(product.ok()).toBe(true);
  await page.goto('/products');
  await expect(
    page.getByRole('article', { name: 'First store yogurt', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('link', { name: 'Create a store account', exact: true }).click();
  await expect(page).toHaveURL('/register');
  await register(page, 'Second independent store', 'second@signup.test');
  await expect(page.getByRole('heading', { name: 'Store overview' })).toBeVisible();
  const second = await (await page.request.get('/api/auth/session')).json();
  expect(second.store.id).not.toBe(first.store.id);
  expect(second.device.id).not.toBe(first.device.id);
  await page.goto('/products');
  await expect(page.getByRole('heading', { name: 'Products', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'First store yogurt', exact: true })).toHaveCount(
    0,
  );
  expect(await (await page.request.get('/api/products')).json()).toEqual([]);
  await page.goto('/login');
  await page.getByLabel('Email address').fill('first@signup.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Store overview' })).toBeVisible();
  await page.goto('/products');
  await expect(
    page.getByRole('article', { name: 'First store yogurt', exact: true }),
  ).toBeVisible();
  expect((await (await page.request.get('/api/auth/session')).json()).store.id).toBe(
    first.store.id,
  );

  await page.goto('/register');
  await register(page, 'Duplicate store', 'first@signup.test');
  await expect(
    page.getByText('An account with this email already exists. Please sign in.', { exact: true }),
  ).toBeVisible();
  expect((await (await page.request.get('/api/auth/session')).json()).store.id).toBe(
    first.store.id,
  );
  expect(errors).toEqual([]);
});

test('registration works on small screens and uses Russian translations', async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.ALLOW_REGISTRATION !== 'true',
    'This scenario requires opt-in registration.',
  );
  await page.setViewportSize({ width: 320, height: 750 });
  await page.goto('/register');
  await page.evaluate(() => localStorage.setItem('eliza.language', 'ru'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Создать магазин', exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Уже есть аккаунт? Войти', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('registration-mobile-ru.png'),
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Уже есть аккаунт? Войти', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'Создать аккаунт владельца', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('disabled registration shows a clear sign-in path', async ({ page }) => {
  await page.route('**/api/auth/status', (route) =>
    route.fulfill({
      json: { needsSetup: false, registrationEnabled: false },
    }),
  );
  await page.goto('/register');
  await expect(
    page.getByText('Store registration is currently disabled.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create my store', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create a store account', exact: true })).toHaveCount(
    0,
  );
});
