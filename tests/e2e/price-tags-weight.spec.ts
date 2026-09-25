import { test, expect } from '@playwright/test';

test('opens inline weight entry instead of selecting a generic price tag', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('Weight label shop');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Email address').fill('weight-label@example.test');
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

  await post('/products', {
    name: 'Apples by weight',
    sku: 'APPLES-WEIGHT',
    category: 'Fruit',
    unit: 'kilogram',
    price: '30',
    cost: '10',
    taxRate: '0',
    minStock: '0',
    barcodes: [],
    plu: '42',
  });
  const profile = await (await page.request.get('/api/store-profile')).json();
  await post('/store-profile', {
    ...profile,
    scaleBarcode: { enabled: true, prefix: '20', productDigits: 5, mode: 'weight', decimals: 3 },
  });
  const roles = await (await page.request.get('/api/team/roles')).json();
  await post('/team', {
    name: 'Sam',
    employeeCode: 'SAM',
    roleId: roles.find((role: { name: string }) => role.name === 'General employee').id,
    pin: '123456',
  });
  const session = await (await page.request.get('/api/auth/session')).json();
  const device = await page.request.patch('/api/devices/' + session.device.id, {
    headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
    data: { name: 'Label station', active: true, type: 'price_tags' },
  });
  expect(device.ok(), await device.text()).toBe(true);

  await page.goto('/price-tags');
  await page.getByLabel('Employee').selectOption('SAM');
  await page.getByLabel('PIN').fill('123456');
  await page.getByRole('button', { name: 'Unlock Price Tags' }).click();
  await expect(page.getByRole('button', { name: /Apples by weight/ })).toBeVisible();
  await page.getByRole('button', { name: /Apples by weight/ }).click();
  await expect(page.getByLabel('Net weight (kg)')).toBeVisible();
  await expect(page.getByRole('button', { name: /Print selected tags/ })).toHaveCount(0);
  await page.getByLabel('Net weight (kg)').fill('0.532');
  await page.getByRole('button', { name: 'Generate weight barcode' }).click();
  await expect(page.locator('.weight-label-result code')).toHaveText(/^20\d{11}$/);
  await expect(page.getByRole('button', { name: 'Print weight label' })).toBeVisible();
  await page.evaluate(() => {
    window.print = () => {
      document.body.dataset.printed = 'yes';
    };
  });
  await page.getByRole('button', { name: 'Print weight label' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-printed', 'yes');
  await expect(page.locator('.price-tags-weight-print .weight-barcode-image')).toHaveCount(1);
});
