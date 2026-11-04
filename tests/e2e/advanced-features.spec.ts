import { test, expect } from './fixtures';

test('advanced tools are opt-in, persist for the store, preserve data and retain permissions', async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  const account = { email: 'advanced@example.test', password: 'test-password-12345' };
  const setup = await page.request.post('/api/auth/setup', {
    headers,
    data: {
      ...account,
      storeName: 'Feature modes',
      ownerName: 'Owner',
      currency: 'NOK',
      timezone: 'Europe/Oslo',
    },
  });
  expect(setup.ok()).toBe(true);
  const profile = await (await page.request.get('/api/store-profile')).json();
  expect(profile.advancedFeaturesEnabled).toBe(false);
  expect(
    (await (await page.request.get('/api/auth/session')).json()).store.advancedFeaturesEnabled,
  ).toBe(false);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const optional = ['Action Center', 'Stock counts', 'Replenishment', 'Digital purchases'];
  for (const name of optional)
    await expect(nav.getByRole('link', { name, exact: true })).toHaveCount(0);
  for (const name of ['Sales', 'Products', 'Inventory', 'Suppliers & purchases'])
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Manager Action Center/ })).toHaveCount(0);
  for (const path of ['/action-center', '/stock-counts', '/replenishment', '/digital-purchases']) {
    await page.goto(path);
    await expect(
      page.getByRole('heading', { name: 'Advanced features are turned off' }),
    ).toBeVisible();
  }
  await page.getByRole('link', { name: 'Open store settings', exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Advanced features', exact: true });
  await expect(toggle).not.toBeChecked();
  await page
    .locator('#advanced-features')
    .screenshot({ path: '/private/tmp/eliza-advanced-features-settings.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(toggle).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .locator('#advanced-features')
    .screenshot({ path: '/private/tmp/eliza-advanced-features-settings-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await toggle.check();
  const saving = page.waitForResponse(
    (r) => r.url().endsWith('/api/store-profile') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Save store settings' }).click();
  expect((await saving).status()).toBe(201);
  for (const name of optional)
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  await page.reload();
  await expect(toggle).toBeChecked();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Manager Action Center/ })).toBeVisible();

  // A real record survives switching to basic mode and back.
  const product = await (
    await page.request.post('/api/products', {
      headers,
      data: {
        name: 'Milk',
        sku: 'MODE-MILK',
        category: 'Dairy',
        unit: 'piece',
        price: '10',
        cost: '5',
        minStock: '0',
        barcodes: [],
      },
    })
  ).json();
  const count = await page.request.post('/api/stock-counts', {
    headers,
    data: {
      requestId: crypto.randomUUID(),
      name: 'Preserved stock count',
      productIds: [product.id],
    },
  });
  expect(count.ok()).toBe(true);
  const countId = (await count.json()).id;

  // Setting is server-side and available to a second browser, not just localStorage.
  const other = await browser.newContext();
  try {
    const login = await other.request.post('http://localhost:5174/api/auth/login', {
      headers,
      data: account,
    });
    expect(login.ok()).toBe(true);
    expect(
      (await (await other.request.get('http://localhost:5174/api/auth/session')).json()).store
        .advancedFeaturesEnabled,
    ).toBe(true);
  } finally {
    await other.close();
  }

  // Existing clients saving other fields without this flag must preserve its value.
  const current = await (await page.request.get('/api/store-profile')).json();
  const { advancedFeaturesEnabled, ...oldClientProfile } = current;
  const compatibility = await page.request.post('/api/store-profile', {
    headers,
    data: oldClientProfile,
  });
  expect((await compatibility.json()).advancedFeaturesEnabled).toBe(true);
  expect(
    (
      await page.request.post('/api/store-profile', {
        headers,
        data: { ...oldClientProfile, advancedFeaturesEnabled: false },
      })
    ).status(),
  ).toBe(409);

  const roles = await (await page.request.get('/api/team/roles')).json();
  const staff = { email: 'staff@advanced.test', password: 'staff-password-12345' };
  const employee = await page.request.post('/api/team', {
    headers,
    data: {
      ...staff,
      name: 'Cashier',
      employeeCode: 'CASHIER',
      roleId: roles.find((r: any) => r.name === 'Cashier').id,
      pin: '123456',
    },
  });
  expect(employee.ok()).toBe(true);
  const staffBrowser = await browser.newContext();
  try {
    expect(
      (
        await staffBrowser.request.post('http://localhost:5174/api/auth/login', {
          headers,
          data: staff,
        })
      ).ok(),
    ).toBe(true);
    const latest = await (await page.request.get('/api/store-profile')).json();
    expect(
      (
        await staffBrowser.request.post('http://localhost:5174/api/store-profile', {
          headers,
          data: { ...latest, advancedFeaturesEnabled: false },
        })
      ).status(),
    ).toBe(403);
    const staffPage = await staffBrowser.newPage();
    await staffPage.addLocatorHandler(
      staffPage.locator('[data-onboarding-dialog][open]'),
      async (dialog) => {
        await dialog.locator('.page-tour-skip').click();
      },
    );
    await staffPage.goto('/');
    await expect(
      staffPage
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name: 'Action Center', exact: true }),
    ).toHaveCount(0);
    await staffPage.goto('/action-center');
    await expect(staffPage.getByRole('heading', { name: 'Access restricted' })).toBeVisible();
  } finally {
    await staffBrowser.close();
  }

  await page.goto('/settings');
  await toggle.uncheck();
  await page.getByRole('button', { name: 'Save store settings' }).click();
  for (const name of optional)
    await expect(nav.getByRole('link', { name, exact: true })).toHaveCount(0);
  await page.goto('/stock-counts');
  await expect(
    page.getByRole('heading', { name: 'Advanced features are turned off' }),
  ).toBeVisible();
  expect((await page.request.get('/api/stock-counts/' + countId)).ok()).toBe(true);
  await page.goto('/settings');
  await toggle.check();
  await page.getByRole('button', { name: 'Save store settings' }).click();
  await expect(nav.getByRole('link', { name: 'Stock counts', exact: true })).toBeVisible();
  await page.goto('/stock-counts');
  await expect(page.getByRole('row').filter({ hasText: 'Preserved stock count' })).toBeVisible();
  expect(errors).toEqual([]);
});
