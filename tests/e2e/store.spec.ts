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

  await expect(page.getByRole('region', { name: 'Sales summary' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Analytics', exact: true }).click();
  const summary = page.getByRole('region', { name: 'Sales summary' });
  await expect(summary).toContainText('NOK 89.82');
  await expect(page.getByRole('region', { name: 'Gross profit', exact: true })).toContainText(
    'NOK 16.21',
  );
  await summary.getByLabel('Group sales by').selectOption('month');
  await summary.getByRole('button', { name: 'Apply filters' }).click();
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
    await summary.getByRole('button', { name: 'Apply filters' }).click();
    await expect(summary.getByRole('columnheader', { name: heading, exact: true })).toBeVisible();
    await expect(summary).toContainText('NOK 89.82');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/report-breakdowns-mobile.png', fullPage: true });
  await summary.getByLabel('Product filter').selectOption({ label: 'Sourdough bread · BREAD-01' });
  const shiftOption = await summary
    .getByLabel('Shift filter')
    .locator('option')
    .nth(1)
    .getAttribute('value');
  await summary.getByLabel('Shift filter').selectOption(shiftOption!);
  await summary.getByLabel('Group sales by').selectOption('product');
  await summary.getByRole('button', { name: 'Apply filters' }).click();
  await expect(summary.getByRole('region', { name: 'Sales over time', exact: true })).toBeVisible();
  await expect(summary).toContainText('NOK 89.82');
  await expect(summary).toContainText('Average per matching receipt');
  await summary.getByLabel('Product filter').selectOption('');
  await summary.getByLabel('Shift filter').selectOption('');
  await summary.getByRole('button', { name: 'Apply filters' }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await summary.getByLabel('From date').fill('2000-01-01');
  await summary.getByLabel('To date').fill('2000-01-31');
  await summary.getByRole('button', { name: 'Apply filters' }).click();
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
  await dialog.getByLabel('Unit cost excl. tax', { exact: true }).fill('21');
  await expect(dialog.getByText('Unit cost increased:', { exact: true })).toBeVisible();
  await dialog.getByLabel('Proposed selling price incl. tax (optional)').fill('54.90');
  await dialog.getByRole('button', { name: 'Save draft' }).click();
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await expect(dialog.getByLabel('Proposed selling price incl. tax (optional)')).toHaveValue(
    '54.90',
  );
  await dialog.getByLabel('Order notes').fill('Two deliveries expected');
  await dialog.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Two deliveries expected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Place order' }).click();
  await page.getByRole('button', { name: 'Receive delivery' }).click();
  await dialog.getByLabel('Delivery reference').fill('DEL-1');
  await dialog.getByLabel(/Sourdough bread —/).fill('18');
  await expect(
    dialog.getByLabel('New selling price incl. tax for Sourdough bread (optional)'),
  ).toHaveValue('54.90');
  await expect(dialog.getByText('Current selling price: NOK 49.90 including tax.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Record delivery' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Record delivery' }).click();
  await expect(page.getByRole('cell', { name: 'partially received', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Receive delivery' }).click();
  await dialog.getByLabel(/Sourdough bread —/).fill('6');
  await expect(dialog.getByText('Current selling price: NOK 54.90 including tax.')).toBeVisible();
  await dialog.getByLabel('New selling price incl. tax for Sourdough bread (optional)').fill('');
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

test('purchase dialog creates suppliers and products and finds barcodes without losing the draft', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('heading').first().waitFor();
  if (await page.getByRole('heading', { name: 'Let’s open your store' }).isVisible()) {
    await page.getByLabel('Store name').fill('Eliza Market');
    await page.getByLabel('Your name').fill('Alex Morgan');
    await page.getByLabel('Email address').fill('alex@example.test');
    await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
    await page.getByRole('button', { name: 'Create my store' }).click();
  } else {
    await page.getByLabel('Email address').fill('alex@example.test');
    await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  await page.getByRole('link', { name: 'Purchases', exact: true }).click();
  await page.getByRole('button', { name: 'New purchase order' }).click();
  const draft = page.getByRole('dialog', { name: 'New purchase order', exact: true });
  await draft.getByLabel('Supplier reference').fill('Keep my draft');
  await draft.getByLabel('Supplier', { exact: true }).selectOption('__new');
  const supplier = page.getByRole('dialog', { name: 'Add supplier', exact: true });
  await supplier.getByLabel('Supplier code').fill('FRESH');
  await supplier.getByLabel('Supplier name').fill('Fresh deliveries');
  await supplier.getByRole('button', { name: 'Save supplier' }).click();
  await expect(supplier).not.toBeVisible();
  await expect(draft.getByLabel('Supplier', { exact: true }).locator('option:checked')).toHaveText(
    'Fresh deliveries',
  );
  await expect(draft.getByLabel('Supplier reference')).toHaveValue('Keep my draft');

  await draft.getByLabel('Product', { exact: true }).selectOption('__new');
  const product = page.getByRole('dialog', { name: 'Add a product', exact: true });
  await product.getByLabel('Product name').fill('Orange juice');
  await product.getByLabel('SKU', { exact: true }).fill('JUICE-01');
  await product.getByLabel('Category', { exact: true }).fill('Drinks');
  await product.getByLabel('Selling price').fill('35');
  await product.getByLabel('Purchase cost').fill('20');
  await product.getByLabel('Barcodes (optional)').fill('7090123456796');
  await product.getByRole('button', { name: 'Create product' }).click();
  await expect(product).not.toBeVisible();
  await expect(
    draft.getByLabel('Product', { exact: true }).locator('option:checked'),
  ).toContainText('Orange juice');
  await expect(draft.getByLabel('Proposed selling price incl. tax (optional)')).toHaveValue(
    '35.00',
  );
  await expect(draft.getByLabel('Unit cost excl. tax', { exact: true })).toHaveValue('20.00');
  await draft.getByLabel('Unit cost excl. tax', { exact: true }).fill('22');
  await expect(draft.locator('.purchase-cost-change')).toHaveCSS('color', 'rgb(180, 35, 24)');
  await expect(
    draft.locator('.field').filter({ hasText: 'Unit cost excl. tax' }).locator('+ .field'),
  ).toContainText('Proposed selling price');

  await draft.getByLabel('Proposed selling price incl. tax (optional)').fill('99');
  await draft.getByRole('button', { name: 'Scan barcode', exact: true }).click();
  const scanner = page.getByRole('dialog', { name: 'Scan barcode', exact: true });
  await scanner.getByLabel('Barcode', { exact: true }).fill('unknown-code');
  await scanner.getByLabel('Barcode', { exact: true }).press('Enter');
  await expect(scanner.getByRole('alert')).toContainText('No active product matches');
  await scanner.getByLabel('Barcode', { exact: true }).fill('7090123456796');
  await scanner.getByLabel('Barcode', { exact: true }).press('Enter');
  await expect(scanner).not.toBeVisible();
  await expect(
    draft.getByLabel('Product', { exact: true }).locator('option:checked'),
  ).toContainText('Orange juice');
  await expect(draft.getByLabel('Proposed selling price incl. tax (optional)')).toHaveValue(
    '35.00',
  );
  await expect(draft.getByLabel('Supplier reference')).toHaveValue('Keep my draft');
  await draft.getByLabel('Product', { exact: true }).selectOption('__new');
  await product.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    draft.getByLabel('Product', { exact: true }).locator('option:checked'),
  ).toContainText('Orange juice');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(draft.getByRole('button', { name: 'Scan barcode', exact: true })).toBeVisible();
  expect(await draft.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/purchase-dialog-mobile.png' });
  await draft.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(draft).not.toBeVisible();
});

test('analytics combines dates, product and shift filters with charts', async ({
  page,
  playwright,
}) => {
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  async function call(client: any, path: string, body?: unknown, method?: string) {
    const response = await client.fetch('http://localhost:5174/api' + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      data: body,
    });
    const result = await response.json();
    expect(response.ok(), JSON.stringify(result)).toBe(true);
    return result;
  }
  const account = {
    storeName: 'Eliza Market',
    ownerName: 'Alex Morgan',
    email: 'alex@example.test',
    password: 'local-test-password-123',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  };
  const status = await call(page.request, '/auth/status');
  await call(page.request, status.needsSetup ? '/auth/setup' : '/auth/login', account);
  const session = await call(page.request, '/auth/session');
  const roles = await call(page.request, '/team/roles');
  await call(
    page.request,
    '/team/' + session.user.id,
    {
      name: 'Alex Morgan',
      employeeCode: 'OWNER',
      roleId: roles.find((r: any) => r.name === 'Owner').id,
      active: true,
      pin: '654321',
    },
    'PATCH',
  );
  const ids = [];
  for (const [name, sku, price] of [
    ['Analytics tea', 'AN-TEA', '100'],
    ['Analytics cup', 'AN-CUP', '50'],
  ]) {
    const p = await call(page.request, '/products', {
      name,
      sku,
      category: 'Analytics demo',
      unit: 'piece',
      price,
      cost: '10',
      taxRate: '0',
      minStock: '0',
      plu: '',
      barcodes: [],
    });
    ids.push(p.id);
    await call(page.request, '/inventory/adjustments', {
      productId: p.id,
      quantity: '10',
      reason: 'opening_balance',
      notes: 'Analytics fixture',
      requestId: crypto.randomUUID(),
    });
  }
  const register = await playwright.request.newContext();
  try {
    await call(register, '/auth/login', account);
    await call(register, '/pos/enroll', { name: 'Analytics register' });
    await call(register, '/pos/login', { employeeCode: 'OWNER', pin: '654321' });
    const shift = await call(register, '/pos/shifts', {
      openingCash: '0',
      requestId: crypto.randomUUID(),
    });
    await call(register, '/pos/sales', {
      requestId: crypto.randomUUID(),
      shiftId: shift.id,
      lines: ids.map((id, i) => ({
        productId: id,
        quantity: '1',
        expectedPrice: i ? '50.00' : '100.00',
        expectedTaxRate: '0.00',
      })),
      discountPercent: '0',
      payment: { method: 'cash', tendered: '150' },
    });
    await page.goto('/analytics');
    await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
    const summary = page.getByRole('region', { name: 'Sales summary', exact: true });
    await summary.getByLabel('Product filter').selectOption(ids[0]);
    await summary.getByLabel('Shift filter').selectOption(shift.id);
    await summary.getByRole('button', { name: 'Apply filters' }).click();
    await expect(summary).toContainText('NOK 100.00');
    await expect(page.getByRole('region', { name: 'Gross profit', exact: true })).toContainText(
      'NOK 90.00',
    );
    await expect(summary.getByRole('region', { name: 'Best products', exact: true })).toContainText(
      'Analytics tea',
    );
    await expect(
      summary.getByRole('region', { name: 'Best products', exact: true }),
    ).not.toContainText('Analytics cup');
    await expect(summary.getByRole('img', { name: 'Sales by Day', exact: true })).toBeVisible();
    await summary.getByLabel('Compare periods').selectOption('dayOfMonth');
    await expect(summary.getByRole('region', { name: 'Best periods', exact: true })).toContainText(
      'Day ',
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: 'test-results/analytics-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'test-results/analytics-mobile.png', fullPage: true });
    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Sales', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Sales summary', exact: true })).toHaveCount(0);
    await page.goto('/shifts');
    await expect(page.getByRole('heading', { name: 'Shifts', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Sales summary', exact: true })).toHaveCount(0);
  } finally {
    await register.dispose();
  }
});
