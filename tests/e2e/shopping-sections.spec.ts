import { test, expect } from '@playwright/test';
test('creates sections, moves items and renames headings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('Planning shop');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Email address').fill('shopping@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await expect(page.getByRole('link', { name: 'Shopping lists', exact: true })).toBeVisible();

  await page.goto('/shopping-lists');
  await page.getByRole('button', { name: 'New shopping list' }).click();
  await page.getByLabel('Shopping list name').fill('Grouped list');
  await page.getByRole('button', { name: 'Generate shopping list' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Add section', exact: true }).click();
  await page.getByLabel('Section name', { exact: true }).fill('Cleaning');
  await page.getByLabel('Section name', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Select a product', exact: true }).click();
  await page.getByPlaceholder('For example: bin bags').fill('Bin bags');
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page
    .getByTitle('Drag to another section')
    .dragTo(page.getByRole('button', { name: 'Cleaning', exact: true }));
  const group = page
    .locator('.shopping-section')
    .filter({ has: page.getByRole('button', { name: 'Cleaning', exact: true }) });
  await expect(group.getByText('Bin bags', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cleaning', exact: true }).click();
  await page.getByLabel('Section name', { exact: true }).fill('Store supplies');
  await page.getByLabel('Section name', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Save shopping list', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Store supplies', exact: true })).toBeVisible();
  await expect(
    page
      .locator('.shopping-section')
      .filter({ has: page.getByRole('button', { name: 'Store supplies', exact: true }) })
      .getByText('Bin bags', { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.getByRole('button', { name: 'Remove section', exact: true }).click();
  await expect(page.getByText('Bin bags', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Store supplies', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save shopping list', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByText('Bin bags', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove section', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
