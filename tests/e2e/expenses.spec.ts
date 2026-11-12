import { test, expect } from './fixtures';
test('records, edits, filters and deletes an expense within Accounting', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('Expense shop');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Email address').fill('expense-ui@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await page.getByRole('link', { name: 'Accounting', exact: true }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Expenses', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('link', { name: 'Expenses', exact: true }).click();
  await expect(page).toHaveURL('/accounting/expenses');
  await expect(page.locator('.accounting-sections a[aria-current="page"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Add expense' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Description', { exact: true }).fill('September rent');
  await dialog.getByLabel(/Amount/).fill('1200.50');
  await dialog.getByLabel('Category', { exact: true }).selectOption('Rent');
  await dialog.getByRole('button', { name: 'Save expense' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('tbody')).toContainText('September rent');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width !== 320)
      await page.screenshot({ path: testInfo.outputPath(`expenses-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('link', { name: 'Financial summary', exact: true }).click();
  const spending = page.locator('.kpi', {
    has: page.locator('.kpi-label', { hasText: /^Operating expenses$/ }),
  });
  const profit = page.locator('.kpi', {
    has: page.locator('.kpi-label', { hasText: /^Store operating profit$/ }),
  });
  await expect(spending).toContainText('1,200.50');
  await expect(profit.locator('.kpi-value')).toHaveText(/-.*1,200\.50/);
  await page.goto('/expenses');
  await expect(page).toHaveURL('/accounting/expenses');

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await dialog.getByLabel(/Amount/).fill('1300.75');
  await dialog.getByRole('button', { name: 'Save expense' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('tbody')).toContainText('1,300.75');
  await page.getByLabel('Search expenses').fill('unknown');
  await expect(page.getByText('No expenses in this period.')).toBeVisible();
  await page.getByLabel('Search expenses').fill('rent');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('No expenses in this period.')).toBeVisible();
  await page.getByRole('link', { name: 'Financial summary', exact: true }).click();
  await expect(spending).toContainText('0.00');
  await expect(profit.locator('.kpi-value')).not.toHaveText(/-/);
});
