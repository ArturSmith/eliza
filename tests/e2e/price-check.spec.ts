import { test, expect } from '@playwright/test';
import sharp from 'sharp';

test('customer price checker displays only the scanned product and current price', async ({
  page,
}) => {
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  const setup = await page.request.post('/api/auth/setup', {
    headers,
    data: {
      storeName: 'Kiosk shop',
      ownerName: 'Owner',
      email: 'owner@kiosk.test',
      password: 'owner-password-12345',
      currency: 'NOK',
      timezone: 'Europe/Oslo',
    },
  });
  expect(setup.ok(), await setup.text()).toBe(true);
  const session = await (await page.request.get('/api/auth/session')).json();
  const image =
    'data:image/jpeg;base64,' +
    (
      await sharp({ create: { width: 2, height: 2, channels: 3, background: '#f4c953' } })
        .jpeg()
        .toBuffer()
    ).toString('base64');
  const created = await page.request.post('/api/products', {
    headers,
    data: {
      name: 'Yogurt',
      description: 'Plain yogurt with live cultures.',
      image,
      source: {
        barcode: '709000000049',
        brand: 'Farmhouse',
        quantity: '500 g',
        imageImported: false,
      },
      sku: 'YOGURT-CHECK',
      category: 'Dairy',
      unit: 'piece',
      price: '70.00',
      cost: '59.00',
      taxRate: '0',
      minStock: '0',
      plu: '',
      barcodes: ['709000000049'],
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const assigned = await page.request.patch('/api/devices/' + session.device.id, {
    headers,
    data: { name: 'Shop floor checker', active: true, type: 'price_check' },
  });
  expect(assigned.ok(), await assigned.text()).toBe(true);

  await page.goto('/price-check');
  await expect(page.getByRole('heading', { name: 'Check a price' })).toBeVisible();
  await expect(page.getByLabel('Camera preview')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scan with camera' })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const input = page.getByLabel('Scan the product barcode');
  await expect(input).toBeFocused();
  await input.fill('709000000049');
  await input.press('Enter');
  await expect(page.getByRole('heading', { name: 'Yogurt' })).toBeVisible();
  await expect(page.getByText('Plain yogurt with live cultures.')).toBeVisible();
  await expect(page.getByText('Farmhouse')).toBeVisible();
  await expect(page.getByText('Dairy')).toBeVisible();
  await expect(page.getByText('500 g')).toBeVisible();
  await expect(page.locator('.price-check-photo img')).toHaveJSProperty('naturalWidth', 2);
  await expect(page.getByText('YOGURT-CHECK')).toHaveCount(0);
  await expect(page.locator('.price-check-price')).toContainText('70.00');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await input.fill('000000000000');
  await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Barcode not found');
  await expect(page.getByRole('heading', { name: 'Yogurt' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Products' })).toHaveCount(0);
});
