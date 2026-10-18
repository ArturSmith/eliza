import { test, expect } from './fixtures';
test('shows hourly sales in an interactive line chart', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('Planning shop');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Email address').fill('hourly-chart@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await expect(page.getByRole('link', { name: 'Shopping lists', exact: true })).toBeVisible();

  async function post(path: string, data: unknown) {
    const response = await page.request.post('/api' + path, {
      headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }

  await page.route('**/api/reports/owner-dashboard?*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.hourly = Array.from({ length: 24 }, (_, i) => ({
      hour: String(i).padStart(2, '0'),
      total: i === 9 ? 123.45 : 0,
      comparison: i === 9 ? 100 : 0,
      elapsed: true,
    }));
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  const chart = page.locator('.hour-line-chart');
  await expect(chart.locator('.hour-sales-line')).toBeVisible();
  await chart.locator('.hour-line-hit').nth(9).hover();
  await expect(chart.getByRole('tooltip')).toContainText('09:00–09:59');
  await expect(chart.getByRole('tooltip')).toContainText('123.45');
  await chart.locator('.hour-line-hit').nth(0).focus();
  await expect(chart.getByRole('tooltip')).toContainText('00:00–00:59');
  await expect(chart.getByRole('tooltip')).toContainText('0.00');
  await page.screenshot({ path: 'test-results/hourly-line-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await chart.locator('.hour-line-hit').nth(9).click();
  await expect(chart.getByRole('tooltip')).toContainText('123.45');
  await page.screenshot({ path: 'test-results/hourly-line-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
