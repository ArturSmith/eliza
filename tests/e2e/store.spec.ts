import { test, expect } from '@playwright/test';
test('owner setup, inventory, employee PINs, checkout recovery, and shift reconciliation', async ({
  page,
}) => {
  test.setTimeout(90000);
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
  await dialog.getByLabel('Tax rate (%)').fill('15');
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
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('link', { name: 'Team', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Alex Morgan' }).click();
  await dialog.getByLabel('New PIN (optional)').fill('654321');
  await dialog.getByRole('button', { name: 'Save employee' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Add employee' }).click();
  await dialog.getByLabel('Employee name').fill('Anna Cashier');
  await dialog.getByLabel('Employee code').fill('ANNA');
  await dialog.getByLabel('Register PIN').fill('123456');
  await dialog.getByRole('button', { name: 'Save employee' }).click();
  await expect(page.getByRole('cell', { name: 'Anna Cashier PIN-only account' })).toBeVisible();
  await page.getByRole('link', { name: 'Checkout', exact: true }).click();
  await page.getByLabel('Register name').fill('Checkout 01');
  await page.getByRole('button', { name: 'Enroll this register' }).click();
  await expect(page.getByRole('heading', { name: 'Ready for your shift?' })).toBeVisible();
  await page.getByLabel('Employee code').selectOption('ANNA');
  await page.getByLabel('Register PIN').fill('123456');
  await page.getByRole('button', { name: 'Unlock register' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start shift', exact: true }).click();
  await dialog.getByLabel('Opening cash').fill('100');
  await dialog.getByRole('button', { name: 'Start shift', exact: true }).click();
  await expect(page.getByText('Shift open', { exact: true })).toBeVisible();
  await page.getByLabel('Scan or search products').fill('7090123456789');
  await page.getByLabel('Scan or search products').press('Enter');
  await expect(page.locator('.cart-line')).toContainText('Sourdough bread');
  await page.reload();
  await expect(page.locator('.cart-line')).toContainText('Sourdough bread');
  await page.getByRole('button', { name: 'Hold', exact: true }).click();
  await page.getByRole('button', { name: 'Held carts (1)' }).click();
  await dialog.getByRole('button', { name: 'Resume' }).click();
  await page.getByLabel('Sale discount (%)').fill('20');
  await page.screenshot({ path: 'test-results/checkout-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Take payment', exact: true }).click();
  await dialog.getByLabel('Cash tendered').fill('50');
  await dialog.getByLabel('Manager employee code').fill('OWNER');
  await dialog.getByLabel('Manager PIN').fill('654321');
  await dialog.getByRole('button', { name: 'Complete sale', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Sale complete' })).toBeVisible();
  await expect(dialog.locator('.receipt')).toContainText('NOK 39.92');
  await expect(dialog.locator('.receipt')).toContainText('Anna Cashier');
  await expect(dialog.locator('.receipt')).toContainText('Approved by Alex Morgan');
  await page.screenshot({ path: 'test-results/checkout-receipt.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Next customer' }).click();
  // Lose a successful response: retrying after reload must recover the same sale.
  await page.getByLabel('Scan or search products').fill('7090123456789');
  await page.getByLabel('Scan or search products').press('Enter');
  await page.getByRole('button', { name: 'Take payment', exact: true }).click();
  await dialog.getByLabel('Cash tendered').fill('50');
  let dropped = false;
  await page.route('**/api/pos/sales', async (route) => {
    if (route.request().method() === 'POST' && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await dialog.getByRole('button', { name: 'Complete sale', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Cannot reach the server');
  await page.reload();
  await page.unroute('**/api/pos/sales');
  await page.getByRole('button', { name: 'Recover payment' }).click();
  await dialog.getByRole('button', { name: 'Retry payment confirmation' }).click();
  await expect(dialog.getByRole('heading', { name: 'Sale complete' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Next customer' }).click();

  await page.getByRole('button', { name: 'Search / refund' }).click();
  await dialog.getByRole('button', { name: 'Open receipt' }).first().click();
  await dialog.getByLabel(/Sourdough bread —/).fill('1');
  await dialog.getByLabel('Saleable: restore stock').check();
  await dialog.getByLabel('Return reason').fill('Customer returned unopened item');
  await dialog.getByLabel('I confirm these items should be refunded in cash.').check();
  await dialog.getByLabel('Approving manager code').fill('OWNER');
  await dialog.getByLabel('Approving manager PIN').fill('654321');
  let refundDropped = false;
  await page.route('**/api/pos/refunds', async (route) => {
    if (!refundDropped) {
      refundDropped = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await dialog.getByRole('button', { name: 'Confirm refund', exact: true }).click();
  await expect(
    dialog.getByText('A refund confirmation is pending.', { exact: false }),
  ).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('Cannot reach the server');
  await page.unroute('**/api/pos/refunds');
  await dialog.getByRole('button', { name: 'Recover refund' }).click();
  await expect(dialog.getByRole('heading', { name: /Refund recorded:/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/refund-recorded.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Close shift', exact: true }).click();
  await dialog.getByLabel('Counted cash').fill('139.92');
  await dialog.getByLabel('Closing notes').fill('Drawer balanced');
  await dialog.getByRole('button', { name: 'Close shift', exact: true }).click();
  await expect(page.getByText('No open shift', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/checkout-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ready for your shift?' })).toBeVisible();
  await page.getByRole('link', { name: 'Management sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByLabel('Email address').fill('alex@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('link', { name: 'Sales', exact: true }).click();
  await expect(
    page.getByRole('table', { name: 'Recent receipts' }).locator('tbody tr'),
  ).toHaveCount(2);
  await page.getByRole('link', { name: 'Shifts', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'closed', exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('table', { name: 'Drawer reconciliation' })
      .getByRole('cell', { name: 'NOK 0.00', exact: true }),
  ).toBeVisible();

  const summary = page.getByRole('region', { name: 'Sales summary' });
  await expect(summary).toContainText('NOK 89.82');
  await expect(page.getByRole('region', { name: 'Gross profit', exact: true })).toContainText(
    'NOK 16.21',
  );
  await summary.getByLabel('Group sales by').selectOption('month');
  await summary.getByRole('button', { name: 'Apply dates' }).click();
  await expect(summary.getByRole('columnheader', { name: 'Month', exact: true })).toBeVisible();
  for (const [group, heading] of [
    ['week', 'Week starting Monday'],
    ['cashier', 'Cashier'],
    ['register', 'Register'],
    ['product', 'Product'],
    ['category', 'Category'],
    ['payment', 'Payment method'],
  ]) {
    await summary.getByLabel('Group sales by').selectOption(group);
    await summary.getByRole('button', { name: 'Apply dates' }).click();
    await expect(summary.getByRole('columnheader', { name: heading, exact: true })).toBeVisible();
    await expect(summary).toContainText('NOK 89.82');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/report-breakdowns-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await summary.getByLabel('From date').fill('2000-01-01');
  await summary.getByLabel('To date').fill('2000-01-31');
  await summary.getByRole('button', { name: 'Apply dates' }).click();
  await expect(summary).toContainText('No completed sales in this date range.');
  await page.screenshot({ path: 'test-results/sales-summary.png', fullPage: true });
  await page.getByRole('link', { name: 'Suppliers', exact: true }).click();
  await page.getByRole('button', { name: 'Add supplier', exact: true }).click();
  await dialog.getByLabel('Supplier code').fill('BAKERY');
  await dialog.getByLabel('Supplier name').fill('Local Bakery');
  await dialog.getByRole('button', { name: 'Save supplier' }).click();
  await expect(page.getByRole('cell', { name: 'Local Bakery BAKERY' })).toBeVisible();
  await page.getByRole('link', { name: 'Purchases', exact: true }).click();
  await page.getByRole('button', { name: 'New purchase order' }).click();
  await dialog.getByLabel('Supplier', { exact: true }).selectOption({ label: 'Local Bakery' });
  await dialog
    .getByLabel('Product', { exact: true })
    .selectOption({ label: 'Sourdough bread · BREAD-01 (piece)' });
  await dialog.getByLabel('Quantity', { exact: true }).fill('24');
  await dialog.getByLabel('Purchase tax %').fill('15');
  await dialog.getByRole('button', { name: 'Save draft' }).click();
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await dialog.getByLabel('Order notes').fill('Two deliveries expected');
  await dialog.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Two deliveries expected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Place order' }).click();
  await page.getByRole('button', { name: 'Receive delivery' }).click();
  await dialog.getByLabel('Delivery reference').fill('DEL-1');
  await dialog.getByLabel(/Sourdough bread/).fill('18');
  await dialog.getByRole('button', { name: 'Record delivery' }).click();
  await expect(page.getByRole('cell', { name: 'partially received', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Receive delivery' }).click();
  await dialog.getByLabel(/Sourdough bread/).fill('6');
  await dialog.getByRole('button', { name: 'Record delivery' }).click();
  await expect(page.getByRole('cell', { name: 'received', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/purchasing-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/purchasing-mobile.png', fullPage: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('link', { name: 'Stock counts', exact: true }).click();
  await page.getByRole('button', { name: 'New stock count' }).click();
  await dialog.getByLabel('Count name').fill('Bakery shelf count');
  await dialog.getByLabel('Sourdough bread · BREAD-01 (piece)', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Create draft' }).click();
  await page.getByRole('button', { name: 'Start counting' }).click();
  await page.getByLabel('Counted Sourdough bread').fill('45');
  await page.getByRole('button', { name: 'Save quantities' }).click();
  await page.getByRole('button', { name: 'Review count', exact: true }).click();
  await expect(
    page
      .getByRole('table', { name: 'Count quantities' })
      .getByRole('cell', { name: '-2.000', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Finalize count', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm finalization' }).click();
  await expect(page.getByRole('cell', { name: 'finalized', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/stock-count-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/stock-count-mobile.png', fullPage: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('link', { name: 'Store settings', exact: true }).click();
  await page.getByLabel('Business address').fill('Market street 12');
  await page.getByLabel('Business / tax registration number').fill('ORG-123');
  await page.getByLabel('Receipt footer').fill('See you again!');
  await page.getByLabel('Default tax rate (%)').fill('25');
  await page.getByRole('button', { name: 'Save store settings' }).click();
  await page.reload();
  await expect(page.getByLabel('Business address')).toHaveValue('Market street 12');
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await page.getByRole('button', { name: 'Add product' }).first().click();
  await expect(dialog.getByLabel('Tax rate (%)')).toHaveValue('25.00');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
});
