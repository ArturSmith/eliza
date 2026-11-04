import { test, expect } from './fixtures';

test('document handoff opens a full purchase page and preserves document costs and review', async ({
  page,
}) => {
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post('/api' + path, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  await post('/auth/setup', {
    storeName: 'Document flow',
    ownerName: 'Owner',
    email: 'handoff@example.test',
    password: 'test-password-12345',
    currency: 'NOK',
    timezone: 'Europe/Oslo',
  });
  const supplier = await post('/suppliers', {
    requestId: crypto.randomUUID(),
    code: 'DOC',
    name: 'Document supplier',
  });
  const product = await post('/products', {
    name: 'Document milk',
    sku: 'DOC-MILK',
    category: 'Dairy',
    unit: 'piece',
    cost: '7',
    price: '10',
    taxRate: '0',
    minStock: '0',
    barcodes: [],
  });
  await page.goto('/purchases');
  await page.evaluate(
    ({ supplierId, productId }) =>
      sessionStorage.setItem(
        'eliza.purchase-assistant.handoff',
        JSON.stringify({
          supplierId,
          reference: 'DOC-2026',
          date: '2026-11-01',
          buyerName: 'Our grocery',
          buyerDetails: 'Oslo',
          driverName: 'Driver',
          driverPhone: '+4791111111',
          goodsNumber: 'G-12',
          buyerTaxNumber: '123',
          grossWeight: '5 kg',
          documentVat: '1.76',
          returnAmount: '0',
          documentComment: 'Read from original',
          focusLine: 0,
          lines: [
            {
              productId,
              quantity: '2',
              unitCost: '8.80',
              taxRate: '10',
              sellingPrice: '',
              source: {
                description: 'Milk from invoice',
                supplierSku: 'DOC-1',
                barcode: '',
                quantity: '2',
                unitCost: '8.80',
                productId,
                matchedBy: 'name',
                ambiguous: false,
              },
            },
          ],
        }),
      ),
    { supplierId: supplier.id, productId: product.id },
  );
  await page.goto('/purchases?document=1');
  await expect(page).toHaveURL('/purchases/new?document=true');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Supplier reference')).toHaveValue('DOC-2026');
  await expect(page.getByLabel('Driver', { exact: true })).toHaveValue('Driver');
  await expect(page.getByLabel('Unit cost excl. tax', { exact: true })).toHaveValue('8.80');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Review the scanned rows');
  await page.locator('.purchase-document-confirm input').check();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page).toHaveURL(/\/purchases\/[\da-f-]+$/);
  const id = new URL(page.url()).pathname.split('/').pop();
  const order = await (await page.request.get('/api/purchases/' + id)).json();
  expect(order.buyer_name).toBe('Our grocery');
  expect(order.driver_phone).toBe('+4791111111');
  expect(order.lines[0].unit_cost).toBe('8.80');
  expect(order.total).toBe('19.36');
  expect((await (await page.request.get('/api/products')).json())[0].stock).toBe('0.000');
  await page.goto('/purchases/new');
  await expect(page.getByLabel('Supplier reference')).toHaveValue('');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});
