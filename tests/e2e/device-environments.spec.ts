import { test, expect } from '@playwright/test';

test('a manager can return an assigned checkout device to Management', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Store name').fill('Device store');
  await page.getByLabel('Your name').fill('Manager');
  await page.getByLabel('Email address').fill('manager@devices.test');
  await page.getByLabel('Password', { exact: true }).fill('manager-password-12345');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await page.getByRole('link', { name: 'Devices' }).click();
  await page.getByRole('button', { name: 'Manage device' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Device environment').selectOption('pos');
  await dialog.getByRole('button', { name: 'Save device' }).click();
  await expect(page.getByRole('heading', { name: 'Ready for your shift?' })).toBeVisible();
  await page.getByRole('link', { name: 'Management sign in' }).click();
  await expect(page).toHaveURL(/\/management-access$/);
  await expect(page.getByRole('heading', { name: 'Switch to Management' })).toBeVisible();
  await page.getByLabel('Management email').fill('manager@devices.test');
  await page.getByLabel('Password', { exact: true }).fill('manager-password-12345');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Switch to Management' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Good to see you, Manager.' })).toBeVisible();
});
