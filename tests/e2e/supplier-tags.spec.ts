import { test, expect } from './fixtures';
test('edits supplier tags and combines supplier filters', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('Planning shop');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Email address').fill('supplier-tags@example.test');
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

  await post('/suppliers', {
    requestId: crypto.randomUUID(),
    code: 'SUP-00001',
    name: 'Drink supplier',
    tags: ['Drinks', 'Local'],
  });
  await post('/suppliers', {
    requestId: crypto.randomUUID(),
    code: 'FOOD',
    name: 'Food supplier',
    tags: ['Food'],
    active: false,
  });
  await page.goto('/suppliers');
  await expect(page.locator('.supplier-directory-card')).toHaveCount(2);
  await page.getByLabel('Search suppliers').fill('local');
  await expect(page.locator('.supplier-directory-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByLabel('Supplier status').selectOption('inactive');
  await expect(page.locator('.supplier-directory-card')).toHaveCount(1);
  await page.getByLabel('Supplier tag').selectOption('Drinks');
  await expect(page.locator('.supplier-directory-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('link', { name: 'Open supplier Drink supplier', exact: true }).click();
  await page.getByRole('link', { name: 'Edit supplier', exact: true }).click();
  await page.getByLabel('Tags (optional)').fill('Drinks, Wholesale');
  await page.getByRole('button', { name: 'Save supplier', exact: true }).click();
  await expect(page.locator('.supplier-profile-summary')).toContainText('Wholesale');
  await page.getByRole('link', { name: 'Back to suppliers', exact: true }).click();
  await page.reload();
  await page.getByLabel('Supplier tag').selectOption('Wholesale');
  await expect(page.locator('.supplier-directory-card')).toHaveCount(1);
  await page.getByRole('link', { name: 'Add supplier', exact: true }).click();
  await page.getByRole('button', { name: 'Generate supplier code', exact: true }).click();
  await expect(page.getByLabel('Supplier code', { exact: true })).toHaveValue('SUP-00002');
  expect(errors).toEqual([]);
});
