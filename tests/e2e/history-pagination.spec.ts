import { test, expect } from './fixtures';

test('Sales and Purchases request separate pages and reset purchase filters to page one', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('History shop');
  await page.getByLabel('Your name').fill('Owner');
  await page.getByLabel('Email address').fill('history@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await expect(page.getByRole('link', { name: 'Sales', exact: true })).toBeVisible();
  await page.route('**/api/reports/sales?*', async (route) => {
    const current = Number(new URL(route.request().url()).searchParams.get('page'));
    await route.fulfill({
      json: {
        page: current,
        pageSize: 50,
        total: 51,
        rows: Array.from({ length: current === 1 ? 50 : 1 }, (_, i) => ({
          id: `sale-${current}-${i}`,
          receiptNumber: `SALE-${current}-${i}`,
          createdAt: '2026-10-18T10:00:00Z',
          timezone: 'Europe/Oslo',
          cashierName: 'Owner',
          deviceName: 'Register',
          total: '10.00',
          currency: 'NOK',
          payment: { method: 'cash' },
        })),
      },
    });
  });
  await page.goto('/sales');
  await expect(page.getByRole('cell', { name: 'SALE-1-0', exact: false })).toBeVisible();
  await expect(page.locator('table[aria-label="Recent receipts"] tbody tr')).toHaveCount(50);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible();
  await expect(page.locator('table[aria-label="Recent receipts"] tbody tr')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(page.getByText('Page 1 of 2', { exact: true })).toBeVisible();
  await page.route('**/api/purchases?*', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const current = Number(params.get('page'));
    const filtered = params.get('status') === 'draft' || !!params.get('search');
    await route.fulfill({
      json: {
        page: current,
        pageSize: 50,
        total: filtered ? 1 : 51,
        rows: [
          {
            id: 'purchase-' + current,
            number: filtered ? 'MATCH' : 'ORDER-' + current,
            supplierName: 'Supplier',
            status: 'draft',
            payment_status: 'unrecorded',
            total: '10.00',
          },
        ],
      },
    });
  });
  await page.goto('/purchases');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible();
  await page.getByLabel('Filter order status').selectOption('draft');
  await expect(page.getByText('Page 1 of 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'MATCH', exact: true })).toBeVisible();
  await page.getByLabel('Search purchase orders').fill('supplier');
  await expect(page.getByText('Page 1 of 1', { exact: true })).toBeVisible();
});
