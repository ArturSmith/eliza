import { test, expect } from './fixtures';

test('management closes another cashier’s shift using the same count and notes, and POS updates automatically', async ({
  page,
  browser,
}, testInfo) => {
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  const account = {
    storeName: 'Management closing shop',
    ownerName: 'Owner',
    email: 'close-manager@test.example',
    password: 'owner-password-12345',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  };
  const post = async (ctx: typeof page.request, path: string, data: unknown) => {
    const response = await ctx.post('/api' + path, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  await post(page.request, '/auth/setup', account);
  const roles = await (await page.request.get('/api/team/roles')).json();
  await post(page.request, '/team', {
    name: 'Anna Cashier',
    employeeCode: 'ANNA',
    roleId: roles.find((r: any) => r.name === 'Cashier').id,
    pin: '123456',
  });
  const checkout = await browser.newContext({ baseURL: 'http://localhost:5174' });
  try {
    await post(checkout.request, '/auth/login', {
      email: account.email,
      password: account.password,
    });
    await post(checkout.request, '/pos/enroll', { name: 'Remote register' });
    await post(checkout.request, '/pos/login', { employeeCode: 'ANNA', pin: '123456' });
    await post(checkout.request, '/pos/onboarding', {
      pageId: 'pos',
      version: 1,
      status: 'skipped',
    });
    const shift = await post(checkout.request, '/pos/shifts', {
      requestId: crypto.randomUUID(),
      openingCash: '100',
    });
    const pos = await checkout.newPage();
    await pos.goto('/pos');
    await expect(pos.locator('.pos-cart')).toBeVisible();
    await page.goto('/shifts');
    const row = page.getByRole('row').filter({ hasText: 'Anna Cashier' });
    await row.getByRole('button', { name: 'Close shift', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Anna Cashier · Remote register');
    await expect(dialog.locator('.notice')).toContainText('100.00');
    await expect(dialog.getByLabel('Counted cash', { exact: true })).toHaveValue('');
    await dialog.getByLabel('Counted cash', { exact: true }).fill('95');
    await dialog
      .getByLabel('Closing notes', { exact: true })
      .fill('Counted by the manager, five short');
    await expect(dialog.getByLabel('Manager PIN')).toHaveCount(0);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await page.evaluate(() =>
      window.dispatchEvent(new StorageEvent('storage', { key: 'eliza.language', newValue: 'ru' })),
    );
    await expect(dialog.getByLabel('Фактические наличные', { exact: true })).toHaveValue('95');
    await expect(dialog.getByLabel('Примечания при закрытии', { exact: true })).toHaveValue(
      'Counted by the manager, five short',
    );
    await page.screenshot({ path: testInfo.outputPath('management-close-ru-mobile.png') });
    const submitted: any[] = [];
    await page.route(`**/api/reports/shifts/${shift.id}/close`, async (route) => {
      submitted.push(route.request().postDataJSON());
      if (submitted.length === 1)
        await route.fulfill({ status: 503, json: { message: 'Please try again.' } });
      else await route.continue();
    });
    await dialog.getByRole('button', { name: 'Закрыть смену', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByLabel('Фактические наличные', { exact: true })).toHaveValue('95');
    await dialog.getByRole('button', { name: 'Закрыть смену', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(submitted).toHaveLength(2);
    expect(submitted[0]).toEqual(submitted[1]);
    await expect(row).toContainText('95,00');
    await expect(row).toContainText('-5,00');
    await expect(row.getByRole('button', { name: 'Закрыть смену', exact: true })).toHaveCount(0);
    await expect(pos.getByRole('heading', { name: 'Shift closed', exact: true })).toBeVisible({
      timeout: 12000,
    });
    expect((await post(checkout.request, '/pos/enter', {})).shift).toBeNull();
  } finally {
    await checkout.close();
  }
});
