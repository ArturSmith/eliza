import { test, expect } from '@playwright/test';
test('owner sets up a store, manages a barcode-free product, and records traceable inventory', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Let’s open your store' })).toBeVisible();
  await page.getByLabel('Store name').fill('Eliza Market');
  await page.getByLabel('Your name').fill('Alex Morgan');
  await page.getByLabel('Email address').fill('alex@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await expect(page.getByRole('heading', { name: 'Good to see you, Alex.' })).toBeVisible();
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await page.getByRole('button', { name: 'Add product' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Product name').fill('Sourdough bread');
  await dialog.getByLabel('SKU', { exact: true }).fill('BREAD-01');
  await dialog.getByLabel('Category', { exact: true }).fill('Bakery');
  await dialog.getByLabel('Selling price').fill('49.90');
  await dialog.getByLabel('Purchase cost').fill('18.50');
  await dialog.getByRole('button', { name: 'Create product' }).click();
  await expect(page.getByRole('cell', { name: 'Sourdough bread BREAD-01' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'No barcode', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Sourdough bread' }).click();
  await dialog.getByLabel('Barcodes (optional)').fill('7090123456789');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('cell', { name: '7090123456789' })).toBeVisible();
  await page.getByRole('link', { name: 'Inventory', exact: true }).click();
  await page.getByRole('button', { name: 'Adjust stock' }).click();
  await dialog
    .getByLabel('Product', { exact: true })
    .selectOption({ label: 'Sourdough bread · 0 piece on hand' });
  await dialog.getByLabel('Quantity change').fill('24');
  await dialog.getByLabel('Notes').fill('Counted before opening');
  await dialog.getByRole('button', { name: 'Record adjustment' }).click();
  await expect(
    page.getByRole('cell', { name: 'Counted before opening', exact: false }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('cell', { name: '24', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Activity log', exact: true }).click();
  await expect(page.getByText('Stock adjusted', { exact: true })).toBeVisible();
  await page.getByText('View recorded details').first().click();
  await expect(page.locator('pre').first()).toContainText('Counted before opening');
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByText('NOK 444.00', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/overview-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Good to see you, Alex.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect
    .poll(() => page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().right))
    .toBeLessThanOrEqual(0);
  await page.screenshot({
    path: 'test-results/overview-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('link', { name: 'Products', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Close navigation' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByLabel('Email address').fill('alex@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good to see you, Alex.' })).toBeVisible();
});
