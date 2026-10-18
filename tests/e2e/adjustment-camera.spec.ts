import { test, expect } from './fixtures';

test('stock adjustment keeps product selection usable beside camera scanner', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Store name').fill('Adjustment scanner shop');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Email address').fill('scanner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await expect(page.getByRole('link', { name: 'Products', exact: true })).toBeVisible();

  const created = await page.request.post('/api/products', {
    headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
    data: {
      name: 'Scanner bread',
      sku: 'SCANNER-BREAD',
      category: 'Bakery',
      unit: 'piece',
      price: '20',
      cost: '10',
      minStock: '0',
      taxRate: '0',
      barcodes: ['7090123456789'],
      plu: '',
    },
  });
  expect(created.ok(), await created.text()).toBe(true);

  await page.goto('/inventory');
  await page.getByRole('button', { name: 'Adjust stock' }).click();
  const adjustment = page.getByRole('dialog', { name: 'Record a stock adjustment' });
  await expect(adjustment.getByRole('button', { name: 'Scan with camera' })).toBeVisible();
  await adjustment.getByRole('button', { name: 'Scan with camera' }).click();
  const scanner = page.getByRole('dialog', { name: 'Scan barcode with camera' });
  await expect(scanner).toBeVisible();
  await scanner.getByRole('button', { name: 'Close dialog' }).click();

  await adjustment.getByRole('button', { name: 'Select a product' }).click();
  await adjustment.getByRole('option', { name: /Scanner bread/ }).click();
  await adjustment.getByPlaceholder('e.g. 24 or -2').fill('2');
  await adjustment.getByRole('button', { name: 'Record adjustment' }).click();
  await expect(adjustment).not.toBeVisible();
});
