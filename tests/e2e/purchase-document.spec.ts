import { test, expect } from '@playwright/test';
test('reviews document suggestions, handles retry, and explicitly saves a purchase draft', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('Document shop');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Email address').fill('documents@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await expect(page.getByRole('link', { name: 'Purchases', exact: true })).toBeVisible();
  async function post(path: string, data: unknown) {
    const response = await page.request.post('/api' + path, {
      headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  const supplier = await post('/suppliers', {
    requestId: crypto.randomUUID(),
    name: 'Document supplier',
    code: 'DOC',
  });
  const products = [];
  for (const name of ['Milk', 'Bread'])
    products.push(
      await post('/products', {
        name,
        sku: name,
        category: 'Food',
        unit: 'piece',
        price: '10',
        cost: '2',
        taxRate: '15',
        minStock: '0',
        barcodes: [],
      }),
    );
  await page.goto('/purchases');
  await page.getByRole('button', { name: 'New purchase order' }).click();
  const draft = page.getByRole('dialog', { name: 'New purchase order', exact: true });
  await expect(draft.getByRole('button', { name: 'Read supplier document' })).toBeDisabled();
  await draft.getByRole('button', { name: 'Select a supplier', exact: true }).click();
  await page.getByRole('option', { name: /Document supplier/ }).click();
  await draft.getByRole('button', { name: 'Read supplier document' }).click();
  const review = page.getByRole('dialog', { name: 'Review supplier document', exact: true });
  await review
    .getByLabel('Document image')
    .setInputFiles({
      name: 'invoice.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('not a PDF'),
    });
  await expect(review.getByRole('alert')).toContainText('Upload a JPEG');
  await review.getByLabel('Document image').setInputFiles({
    name: 'invoice.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  let calls = 0;
  await page.route('**/api/purchases/extract', async (route) => {
    expect(route.request().postDataJSON().supplierId).toBe(supplier.id);
    calls++;
    if (calls === 1) {
      await route.fulfill({
        status: 503,
        json: {
          message:
            'The document could not be read just now. Try again, or enter the purchase manually.',
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        supplierReference: 'INV-100',
        documentDate: '2026-09-16',
        mergedCount: 0,
        unmatched: 1,
        lines: [
          {
            description: 'Milk document',
            supplierSku: 'MILK',
            barcode: '',
            quantity: '2',
            unitCost: '3',
            productId: products[0].id,
            matchedBy: 'sku',
            ambiguous: false,
          },
          {
            description: 'Bread document',
            supplierSku: 'UNKNOWN',
            barcode: '',
            quantity: '1',
            unitCost: '4',
            productId: null,
            matchedBy: null,
            ambiguous: false,
          },
        ],
      },
    });
  });
  await review.getByRole('button', { name: 'Read document', exact: true }).click();
  await expect(review.getByRole('alert')).toContainText('could not be read');
  await review.getByRole('button', { name: 'Read document', exact: true }).click();
  const milk = review.getByRole('region', { name: 'Document line 1' });
  const bread = review.getByRole('region', { name: 'Document line 2' });
  await expect(milk).toBeVisible();
  await expect(milk.getByLabel('Tax %')).toHaveValue('');
  const apply = review.getByRole('button', { name: 'Add reviewed lines to draft' });
  await expect(apply).toBeDisabled();
  await milk.getByLabel('Tax %').fill('0');
  await bread.getByRole('button', { name: 'Select a product', exact: true }).click();
  await page.getByRole('option', { name: /Milk/ }).click();
  await bread.getByLabel('Tax %').fill('0');
  await expect(review.getByRole('alert')).toContainText('appears more than once');
  await bread.getByRole('button', { name: /Milk/ }).click();
  await page.getByRole('option', { name: /Bread/ }).click();
  await bread.getByLabel('Quantity', { exact: true }).fill('1.5');
  await review.getByRole('checkbox').check();
  await expect(apply).toBeDisabled(); // Pieces must be whole.
  await bread.getByLabel('Quantity', { exact: true }).fill('3');
  await review.getByRole('checkbox').check();
  await expect(apply).toBeEnabled();
  await review.screenshot({ path: test.info().outputPath('document-review.png') });
  expect(await page.request.get('/api/purchases').then((r) => r.json())).toHaveLength(0);
  await apply.click();
  await expect(review).not.toBeVisible();
  await expect(draft.getByLabel('Supplier reference')).toHaveValue('INV-100');
  expect(await page.request.get('/api/purchases').then((r) => r.json())).toHaveLength(0);
  await draft.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(draft).not.toBeVisible();
  const orders = await page.request.get('/api/purchases').then((r) => r.json());
  expect(orders).toHaveLength(1);
  expect(orders[0]).toMatchObject({ status: 'draft', total: '18.00' });
  const stock = await page.request.get('/api/products').then((r) => r.json());
  expect(stock.every((p: any) => p.stock === '0.000' && p.price === '10.00')).toBe(true);
  await page.goto('/purchases');
  await page.getByLabel('Language', { exact: true }).selectOption('ru');
  await page.getByRole('button', { name: 'Новый заказ поставщику' }).click();
  await expect(page.getByRole('button', { name: 'Прочитать документ поставщика' })).toBeVisible();
  expect(errors).toEqual([]);
});
