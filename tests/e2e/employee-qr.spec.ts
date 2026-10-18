import { test, expect } from './fixtures';

test('manager issues a printable QR and employee unlocks checkout with it', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('QR shop');
  await page.getByLabel('Your name').fill('Manager');
  await page.getByLabel('Email address').fill('qr-manager@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await expect(page.getByRole('link', { name: 'Team', exact: true })).toBeVisible();
  await page.goto('/team');
  await page.getByRole('button', { name: 'Add employee' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add an employee' });
  await dialog.getByLabel('First name', { exact: true }).fill('QR');
  await dialog.getByLabel('Last name').fill('Cashier');
  await dialog.getByLabel('Birth year').fill('1995');
  await dialog.getByLabel('Contact phone').fill('+47 12345678');
  await dialog.getByLabel('Gender', { exact: true }).selectOption('female');
  await dialog.getByRole('button', { name: 'Generate employee code' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Employee code' })).toHaveValue(
    /^EMP-[A-Z0-9]{5}$/,
  );
  await dialog.getByLabel('Register PIN').fill('123456');
  const created = page.waitForResponse(
    (response) => response.url().endsWith('/api/team') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Save employee' }).click();
  const qrCredential = (await (await created).json()).qrCredential as string;
  expect(qrCredential).toMatch(/^ELIZA-STAFF:[0-9a-f]{64}$/);
  const qrDialog = page.getByRole('dialog', { name: 'Employee QR credential' });
  await expect(qrDialog.locator('.employee-qr-print svg')).toBeVisible();
  await expect(qrDialog.getByRole('button', { name: 'Print employee QR' })).toBeEnabled();
  await page.evaluate(() => {
    (window as any).__printed = false;
    window.print = () => {
      (window as any).__printed = true;
    };
  });
  await qrDialog.getByRole('button', { name: 'Print employee QR' }).click();
  expect(await page.evaluate(() => (window as any).__printed)).toBe(true);
  await qrDialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Edit QR Cashier', exact: true }).click();
  const profile = page.getByRole('dialog', { name: 'Edit employee', exact: true });
  await expect(profile.getByLabel('First name', { exact: true })).toHaveValue('QR');
  await expect(profile.getByLabel('Last name')).toHaveValue('Cashier');
  await expect(profile.getByLabel('Birth year')).toHaveValue('1995');
  await expect(profile.getByLabel('Contact phone')).toHaveValue('+47 12345678');
  await profile.getByLabel('Contact phone').fill('+47 87654321');
  await profile.getByRole('button', { name: 'Save employee' }).click();
  await expect(profile).not.toBeVisible();
  await expect(page.getByText('+47 87654321', { exact: true })).toBeVisible();
  await page.goto('/devices');
  await page.getByRole('button', { name: 'Manage device' }).click();
  const deviceDialog = page.getByRole('dialog');
  await deviceDialog.getByLabel('Device name').fill('QR register');
  await deviceDialog.getByLabel('Device environment').selectOption('pos');
  await deviceDialog.getByRole('button', { name: 'Save device' }).click();
  await expect(page.getByRole('heading', { name: 'Ready for your shift?' })).toBeVisible();
  await page.getByLabel('Employee QR code').fill(qrCredential);
  await page.getByRole('button', { name: 'Unlock with QR' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout', exact: true })).toBeVisible();
});
