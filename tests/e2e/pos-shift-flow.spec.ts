import { test, expect } from './fixtures';

test('a closed register only offers start and language, with opening cash on its own screen', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  async function post(path: string, data: unknown) {
    const response = await page.request.post('/api' + path, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  await post('/auth/setup', {
    storeName: 'Shift flow market',
    ownerName: 'Anna',
    email: 'shift-flow@example.test',
    password: 'test-password-12345',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  });
  const session = await (await page.request.get('/api/auth/session')).json();
  const roles = await (await page.request.get('/api/team/roles')).json();
  const edited = await page.request.patch('/api/team/' + session.user.id, {
    headers,
    data: {
      name: 'Anna',
      employeeCode: 'ANNA',
      roleId: roles.find((role: any) => role.name === 'Owner').id,
      active: true,
      pin: '123456',
    },
  });
  expect(edited.ok(), await edited.text()).toBe(true);
  await post('/pos/enroll', { name: 'Checkout 01' });
  await post('/pos/login', { employeeCode: 'ANNA', pin: '123456' });

  let catalogRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/pos/catalog')) catalogRequests++;
  });
  await page.goto('/pos');
  await expect(page.getByRole('heading', { name: 'Shift closed', exact: true })).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Start shift', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Language' })).toBeVisible();
  await expect(page.locator('.pos-catalog, .pos-cart, .pos-footer')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('combobox', { name: 'Language' }).selectOption('ru');
  await expect(page.getByRole('heading', { name: 'Смена закрыта', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть смену', exact: true })).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 568 });
    await expect(page.getByRole('button', { name: 'Открыть смену', exact: true })).toBeInViewport();
    await expect(page.getByRole('combobox')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width === 1440)
      expect(
        await page
          .locator('.pos-shift-card')
          .evaluate((card) => card.getBoundingClientRect().width),
      ).toBe(440);
    await page.screenshot({ path: testInfo.outputPath(`closed-${width}.png`) });
  }
  await page.getByRole('combobox').selectOption('en');
  await page.getByRole('button', { name: 'Start shift', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Opening cash', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Opening cash', exact: true })).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.pos-catalog, .pos-cart')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Opening cash', exact: true }).fill('125');
  await page.getByRole('combobox').selectOption('ru');
  await expect(
    page.getByRole('heading', { name: 'Начальная сумма наличных', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Отмена', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('opening-ru-320.png') });
  await page.getByRole('combobox').selectOption('en');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Shift closed', exact: true })).toBeVisible();
  expect((await post('/pos/enter', {})).shift).toBeNull();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Shift closed', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start shift', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Opening cash', exact: true })).toHaveValue(
    '0.00',
  );
  await page.getByRole('textbox', { name: 'Opening cash', exact: true }).fill('125');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 568 });
    await expect(page.getByRole('button', { name: 'Start shift', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`opening-${width}.png`) });
  }
  expect(catalogRequests).toBe(0);

  // A failed opening stays on this screen, preserving the amount and request ID.
  const requests: { requestId: string; openingCash: string }[] = [];
  await page.route('**/api/pos/shifts', async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Please try again.' }),
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Start shift', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Please try again.');
  await expect(page.getByRole('textbox', { name: 'Opening cash', exact: true })).toHaveValue('125');
  await page.getByRole('button', { name: 'Start shift', exact: true }).click();
  await expect(page.getByLabel('Scan or search products')).toBeFocused();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  const opened = (await post('/pos/enter', {})).shift;
  expect(opened.openingCash).toBe('125.00');
  expect(opened.expectedCash).toBe('125.00');
  expect(catalogRequests).toBeGreaterThan(0);
  await expect(page.locator('.pos-shift-screen')).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Close shift', exact: true }).click();
  const close = page.getByRole('dialog', { name: 'Close your shift', exact: true });
  await close.getByLabel('Counted cash').fill('125');
  await close.getByRole('button', { name: 'Close shift', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Shift closed', exact: true })).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(1);
  await expect(page.locator('.pos-catalog, .pos-cart, .pos-footer')).toHaveCount(0);
  expect((await post('/pos/enter', {})).shift).toBeNull();
  expect(errors).toEqual([]);
});
