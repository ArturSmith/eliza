import { test, expect } from '@playwright/test';

test('digital scans stay separate from purchase orders', async ({ page }) => {
  await page.goto('/');
  const setup = await page.request.get('/api/auth/status').then((response) => response.json());
  if (setup.needsSetup) {
    await page.getByLabel('Store name', { exact: true }).fill('Document shop');
    await page.getByLabel('Your name').fill('Alex');
  }
  await page.getByLabel('Email address').fill('ai-ui@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: setup.needsSetup ? 'Create my store' : 'Sign in' }).click();
  await expect(page.getByRole('link', { name: 'Eliza AI' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Scanned documents' })).toHaveCount(0);
  await expect(page.request.get('/api/purchases').then((response) => response.json())).resolves.toHaveLength(0);
});
