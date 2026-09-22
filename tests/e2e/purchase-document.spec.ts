import { test, expect } from '@playwright/test';

const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=',
  'base64',
);
const document = {
  documentType: 'Invoice', language: 'ru', title: 'Реализация товаров № U2-12670',
  number: 'U2-12670', date: '8 сентября 2026 г.', currency: '₽', summary: '', pages: 1,
  parties: [
    { role: 'Поставщик', name: 'ИП Магомадов Р.А.', details: '+7 969 722-22-22' },
    { role: 'Покупатель', name: 'Чир-корт', details: '' },
  ],
  fields: [], sections: [], additionalText: [], annotations: [], printedTotal: '14', extractionWarnings: [],
  tables: [{ id: 'items', title: 'Товары', columns: [
    { key: 'sku', label: 'Артикул', kind: 'text' },
    { key: 'product', label: 'Товар', kind: 'text' },
    { key: 'quantity', label: 'Количество', kind: 'quantity' },
    { key: 'price', label: 'Цена', kind: 'price' },
    { key: 'amount', label: 'Сумма', kind: 'amount' },
  ], rows: [
    { rowNumber: '1', cells: ['MILK', 'Milk', '2', '3', '6'] },
    { rowNumber: '2', cells: ['NEW', 'Special scanned loaf', '1', '8', '8'] },
  ], footerRows: [] }],
};

test('prepares a purchase from the new document chat and removes the old route', async ({ page }) => {
  await page.goto('/');
  const setup = await page.request.get('/api/auth/status').then((response) => response.json());
  if (setup.needsSetup) {
    await page.getByLabel('Store name', { exact: true }).fill('Document shop');
    await page.getByLabel('Your name').fill('Alex');
  }
  await page.getByLabel('Email address').fill('documents@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: setup.needsSetup ? 'Create my store' : 'Sign in' }).click();
  await expect(page.getByRole('link', { name: 'Purchases', exact: true })).toBeVisible();
  async function post(path: string, data: unknown) {
    const response = await page.request.post('/api' + path, {
      headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' }, data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  await post('/suppliers', {
    requestId: crypto.randomUUID(), name: 'Existing Magomadov supplier', code: 'EAST', phone: '+7 969 722-22-22',
  });
  await post('/products', {
    name: 'Milk', sku: 'MILK', category: 'Food', unit: 'piece', price: '10', cost: '2', taxRate: '15', minStock: '0', barcodes: [],
  });
  const id = 'b13a452a-6a6e-4b8f-9300-09b831dbe202';
  const saved = { id, filename: 'invoice.png', mimeType: 'image/png', documentType: 'Invoice',
    extracted: document, edited: document, validation: { rowSum: '14.00', printedTotal: '14.00', difference: '0.00', warnings: [] },
    version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await page.route('**/api/documents/scan', (route) => route.fulfill({ json: saved }));
  await page.route('**/api/documents/**', (route) => route.request().url().endsWith('/file')
    ? route.fulfill({ status: 200, contentType: 'image/png', body: pixel })
    : route.fulfill({ json: saved }));
  await page.goto('/documents');
  await page.getByLabel('Choose file').setInputFiles({ name: 'invoice.png', mimeType: 'image/png', buffer: pixel });
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('button', { name: 'Prepare purchase order' })).toBeVisible();
  await page.getByRole('button', { name: 'Prepare purchase order' }).click();
  await expect(page.getByText('Existing Magomadov supplier', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create new supplier' }).click();
  const supplierDialog = page.getByRole('dialog', { name: 'Add supplier' });
  await expect(supplierDialog.getByLabel('Supplier name')).toHaveValue('ИП Магомадов Р.А.');
  await expect(supplierDialog.getByLabel('Phone', { exact: true })).toHaveValue('+7 969 722-22-22');
  await expect(supplierDialog.getByLabel('Supplier code')).toHaveValue(/^SUP-[A-F0-9]{8}$/);
  await supplierDialog.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Use this supplier' }).click();
  await expect(page.getByText('I matched 1 products; 1 need your review.')).toBeVisible();
  await page.getByRole('button', { name: /Special scanned loaf/ }).click();
  await expect(page).toHaveURL(/\/purchases\?document=1/);
  const draft = page.getByRole('dialog', { name: 'New purchase order', exact: true });
  await expect(draft).toBeVisible();
  await expect(draft.getByLabel('Supplier reference')).toHaveValue('U2-12670');
  await expect(draft.getByLabel('Document date (optional)')).toHaveValue('2026-09-08');
  const milk = draft.getByRole('row', { name: 'Purchase row 1', exact: true });
  const loaf = draft.getByRole('row', { name: 'Purchase row 2', exact: true });
  await expect(milk.getByLabel('Quantity', { exact: true })).toHaveValue('2');
  await expect(milk.getByLabel('Unit cost excl. tax')).toHaveValue('3.00');
  await expect(loaf).toHaveClass(/purchase-review-focus/);
  await expect(loaf.getByRole('button', { name: 'Create new product' })).toBeVisible();
  expect(await page.request.get('/api/purchases').then((response) => response.json())).toHaveLength(0);
  await page.goto('/purchase-assistant');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
