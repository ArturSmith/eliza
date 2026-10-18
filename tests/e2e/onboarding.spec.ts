import { test, expect } from '@playwright/test';

test('page walkthroughs support navigation, completion, replay, mobile and cross-browser persistence', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('Guided store');
  await page.getByLabel('Your name').fill('Owner');
  await page.getByLabel('Email address').fill('guide@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  const tour = page.getByRole('dialog', { name: 'Page walkthrough', exact: true });
  await expect(tour).toBeVisible();
  await expect(tour).toContainText('Step 1 of');
  await expect
    .poll(() => tour.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await tour.getByRole('button', { name: 'Next step' }).click();
  await expect(tour).toContainText('Step 2 of');
  await tour.getByRole('button', { name: 'Previous step' }).click();
  await expect(tour).toContainText('Step 1 of');
  await page.keyboard.press('Escape');
  await expect(tour).not.toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/auth/onboarding')).json()).find(
          (p: any) => p.pageId === 'overview',
        )?.status,
    )
    .toBe('skipped');

  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await expect(tour).toBeVisible();
  await expect(tour.getByRole('heading', { name: 'Products', exact: true })).toBeVisible();
  for (let n = 0; n < 2; n++) await tour.getByRole('button', { name: 'Next step' }).click();
  await tour.getByRole('button', { name: 'Finish tour' }).click();
  await expect(tour).not.toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/auth/onboarding')).json()).find(
          (p: any) => p.pageId === 'products',
        )?.status,
    )
    .toBe('completed');
  expect(await (await page.request.get('/api/products')).json()).toHaveLength(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Page guide', exact: true })).toBeVisible();
  await page.waitForTimeout(1000); // Verify suppression beyond the automatic-start delay.
  await expect(tour).not.toBeVisible();
  await page.getByRole('button', { name: 'Page guide', exact: true }).click();
  await expect(tour).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const box = await tour.locator('.page-tour-card').boundingBox();
      return (
        box !== null &&
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= 390 &&
        box.y + box.height <= 844
      );
    })
    .toBe(true);
  for (let n = 0; n < 8; n++) await page.keyboard.press('Tab');
  expect(await tour.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.screenshot({ path: '/private/tmp/eliza-onboarding-mobile.png' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => localStorage.setItem('eliza.language', 'ru'));
  await page.reload();
  await page.getByRole('button', { name: 'Инструкция по экрану', exact: true }).click();
  const russianTour = page.getByRole('dialog', { name: 'Знакомство с экраном' });
  await russianTour.getByRole('button', { name: 'Далее' }).click();
  await expect(russianTour.getByRole('heading', { name: 'Создание товара' })).toBeVisible();
  await page.screenshot({ path: '/private/tmp/eliza-onboarding-desktop.png' });
  await page.keyboard.press('Escape');

  const anotherBrowser = await browser.newContext();
  try {
    const otherPage = await anotherBrowser.newPage();
    otherPage.on('pageerror', (error) => errors.push(error.message));
    await otherPage.goto('/');
    await otherPage.getByLabel('Email address').fill('guide@example.test');
    await otherPage.getByLabel('Password', { exact: true }).fill('local-test-password-123');
    await otherPage.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(otherPage.getByRole('button', { name: 'Page guide', exact: true })).toBeVisible();
    await otherPage.waitForTimeout(1000);
    await expect(otherPage.locator('[data-onboarding-dialog][open]')).toHaveCount(0);
    await otherPage.getByRole('link', { name: 'Inventory', exact: true }).click();
    await expect(otherPage.getByRole('dialog', { name: 'Page walkthrough' })).toBeVisible();
    // Navigation cancels the previous page's spotlight without saving a completion.
    await otherPage.goto('/products');
    await expect(otherPage.getByRole('button', { name: 'Page guide', exact: true })).toBeVisible();
    await otherPage.waitForTimeout(1000);
    await expect(otherPage.locator('[data-onboarding-dialog][open]')).toHaveCount(0);

    for (const path of [
      '/suppliers',
      '/purchases',
      '/shopping-lists',
      '/stock-counts',
      '/replenishment',
      '/ai',
      '/digital-purchases',
      '/analytics',
      '/action-center',
      '/sales',
      '/shifts',
      '/audit',
      '/team',
      '/devices',
      '/settings',
      '/store-layout',
      '/expenses',
      '/promotions',
    ]) {
      await otherPage.goto(path);
      const guide = otherPage.getByRole('dialog', { name: 'Page walkthrough', exact: true });
      await expect(guide, path).toBeVisible();
      for (let step = 0; step < 4; step++) {
        const finish = guide.getByRole('button', { name: 'Finish tour', exact: true });
        if (await finish.isVisible()) {
          await finish.click();
          break;
        }
        await guide.getByRole('button', { name: 'Next step', exact: true }).click();
      }
      await expect(guide, path).not.toBeVisible();
    }
  } finally {
    await anotherBrowser.close();
  }
  expect(errors).toEqual([]);
});

test('checkout and Price Tags walkthroughs belong to the signed-in employee', async ({
  page,
  browser,
}) => {
  test.setTimeout(45000);
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  const post = async (
    client: typeof page.request,
    path: string,
    data: unknown,
    method = 'post',
  ) => {
    const response = await client.fetch('/api' + path, { method, headers, data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  await post(page.request, '/auth/login', {
    email: 'guide@example.test',
    password: 'local-test-password-123',
  });
  const session = await (await page.request.get('/api/auth/session')).json();
  const roles = await (await page.request.get('/api/team/roles')).json();
  const roleIds = roles
    .filter((r: any) => ['Cashier', 'General employee'].includes(r.name))
    .map((r: any) => r.id);
  await post(page.request, '/team', {
    name: 'Guide employee',
    employeeCode: 'GUIDE',
    roleId: roleIds[0],
    roleIds,
    pin: '123456',
  });
  await post(
    page.request,
    '/devices/' + session.device.id,
    { name: 'Guided register', type: 'pos', active: true },
    'PATCH',
  );
  await post(page.request, '/pos/enter', {});
  await post(page.request, '/pos/login', { employeeCode: 'GUIDE', pin: '123456' });
  await post(page.request, '/pos/shifts', { openingCash: '0', requestId: crypto.randomUUID() });
  await page.goto('/pos');
  const guide = page.getByRole('dialog', { name: 'Page walkthrough', exact: true });
  await expect(guide).toBeVisible();
  await guide.getByRole('button', { name: 'Next step' }).click();
  await expect(guide.getByRole('heading', { name: 'Scan or search', exact: true })).toBeVisible();
  await guide.getByRole('button', { name: 'Next step' }).click();
  await guide.getByRole('button', { name: 'Finish tour' }).click();
  await expect(guide).not.toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/pos/onboarding')).json()).find(
          (p: any) => p.pageId === 'pos',
        )?.status,
    )
    .toBe('completed');
  await expect(page.locator('.pos-search input')).toBeFocused();

  const station = await browser.newContext();
  try {
    const stationPage = await station.newPage();
    await post(stationPage.request, '/auth/login', {
      email: 'guide@example.test',
      password: 'local-test-password-123',
    });
    const stationSession = await (await stationPage.request.get('/api/auth/session')).json();
    await post(
      stationPage.request,
      '/devices/' + stationSession.device.id,
      { name: 'Guided labels', type: 'price_tags', active: true },
      'PATCH',
    );
    await post(stationPage.request, '/price-tags/login', { employeeCode: 'GUIDE', pin: '123456' });
    await stationPage.goto('/price-tags');
    const labelsGuide = stationPage.getByRole('dialog', { name: 'Page walkthrough', exact: true });
    await expect(labelsGuide).toBeVisible();
    await labelsGuide.getByRole('button', { name: 'Next step' }).click();
    await expect(
      labelsGuide.getByRole('heading', { name: 'Choose the label type', exact: true }),
    ).toBeVisible();
    await labelsGuide.getByRole('button', { name: 'Next step' }).click();
    await labelsGuide.getByRole('button', { name: 'Finish tour' }).click();
    await expect(labelsGuide).not.toBeVisible();
    const progress = await (await stationPage.request.get('/api/price-tags/onboarding')).json();
    expect(progress).toEqual(
      expect.arrayContaining([
        { pageId: 'pos', version: 1, status: 'completed' },
        { pageId: 'price-tags', version: 1, status: 'completed' },
      ]),
    );
  } finally {
    await station.close();
  }
});
