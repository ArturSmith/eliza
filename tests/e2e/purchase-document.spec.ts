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
  const review = page.getByRole('dialog', { name: 'Read supplier document', exact: true });
  await review.getByLabel('Document image').setInputFiles({
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
            'OpenAI API credits or spending quota are exhausted. Check API billing and usage limits, then try again.',
          details: {
            providerStatus: 429,
            providerCode: 'insufficient_quota',
            requestId: 'req_browser_test',
          },
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
            barcode: '4006381333931',
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
  await expect(review.getByRole('alert')).toContainText('credits or spending quota');
  await review.getByText('Technical details', { exact: true }).click();
  await expect(review.getByText('insufficient_quota', { exact: true })).toBeVisible();
  await expect(review.getByText('req_browser_test', { exact: true })).toBeVisible();
  await review.getByRole('button', { name: 'Read document', exact: true }).click();
  await expect(review).not.toBeVisible();
  const table = draft.getByRole('table', { name: 'Purchase items' });
  const milk = table.getByRole('row', { name: 'Purchase row 1', exact: true });
  const bread = table.getByRole('row', { name: 'Purchase row 2', exact: true });
  await expect(milk).toBeVisible();
  await expect(milk.getByLabel('Quantity', { exact: true })).toHaveValue('2');
  await expect(milk.getByLabel('Purchase tax %')).toHaveValue('');
  await expect(draft.getByLabel('Supplier reference')).toHaveValue('INV-100');
  await draft.getByRole('button', { name: 'Generate reference', exact: true }).click();
  const generatedReference = await draft
    .getByLabel('Supplier reference', { exact: true })
    .inputValue();
  expect(generatedReference).toMatch(/^REF-[A-F0-9]{16}$/);
  await expect(draft).toBeVisible();
  await draft.getByLabel('Supplier reference', { exact: true }).fill(generatedReference + '-EDIT');
  await milk.getByLabel('Purchase tax %').fill('0');
  await bread.getByRole('button', { name: 'Create new product', exact: true }).click();
  const addProduct = page.getByRole('dialog', { name: 'Add a product', exact: true });
  await expect(addProduct.getByLabel('Product name', { exact: true })).toHaveValue(
    'Bread document',
  );
  await expect(addProduct.getByLabel('Description (optional)')).toHaveValue('Bread document');
  await expect(addProduct.getByLabel('Purchase cost', { exact: true })).toHaveValue('4');
  await expect(addProduct.getByLabel('Barcodes (optional)')).toHaveValue('4006381333931');
  await expect(addProduct.getByLabel('Selling price', { exact: true })).toHaveValue('4.60');
  await expect(addProduct.getByLabel('SKU', { exact: true })).not.toHaveValue('UNKNOWN');
  await expect(addProduct.getByLabel('PLU / short code (optional)')).not.toHaveValue('');
  await addProduct.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    bread.getByRole('button', { name: 'Create new product', exact: true }),
  ).toBeVisible();
  expect(await page.request.get('/api/products').then((r) => r.json())).toHaveLength(2);
  await bread.getByRole('button', { name: 'Create new product', exact: true }).click();
  await addProduct.getByLabel('Category', { exact: true }).fill('Bakery');
  await addProduct.getByLabel('Selling price', { exact: true }).fill('10');
  await addProduct.getByRole('button', { name: 'Create product', exact: true }).click();
  await expect(addProduct).not.toBeVisible();
  await expect(bread.getByRole('button', { name: /Bread document/ })).toBeVisible();
  await expect(bread.getByLabel('Quantity', { exact: true })).toHaveValue('1');
  await expect(bread.getByLabel('Unit cost excl. tax')).toHaveValue('4');
  const created = await page.request.get('/api/products').then((r) => r.json());
  expect(created.find((p: any) => p.name === 'Bread document')).toMatchObject({
    stock: '0.000',
    cost: '4.00',
    barcodes: ['4006381333931'],
  });
  await bread.getByRole('button', { name: /Bread document/ }).click();
  await bread.getByRole('option', { name: /Milk/ }).click();
  await bread.getByLabel('Purchase tax %').fill('0');
  await draft.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(draft.getByRole('alert')).toContainText('combine duplicate');
  await bread.getByRole('button', { name: /Milk/ }).click();
  await bread.getByRole('option', { name: /Bread document/ }).click();
  await expect(bread.getByLabel('Unit cost excl. tax')).toHaveValue('4'); // A new match keeps the scanned cost.
  await bread.getByLabel('Quantity', { exact: true }).fill('1.5');
  await draft.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(draft.getByRole('alert')).toContainText('whole numbers');
  await bread.getByLabel('Quantity', { exact: true }).fill('3');
  await milk.getByLabel('Unit cost excl. tax').fill('3.50');
  await milk.getByLabel('Purchase tax %').fill('10');
  await milk.getByLabel('Proposed selling price incl. tax (optional)').fill('11');
  await expect(draft.locator('.purchase-draft-totals')).toContainText('19.70');
  await draft.getByRole('button', { name: 'Add product', exact: true }).click();
  await expect(table.getByRole('row')).toHaveCount(4);
  await table
    .getByRole('row', { name: 'Purchase row 3', exact: true })
    .getByRole('button', { name: 'Remove line', exact: true })
    .click();
  await expect(table.getByRole('row')).toHaveCount(3);
  await draft.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(draft.getByRole('alert')).toContainText('confirm the document check');
  expect(await page.request.get('/api/purchases').then((r) => r.json())).toHaveLength(0);
  await draft.getByRole('checkbox').check();
  await milk.getByLabel('Quantity', { exact: true }).fill('2');
  // Editing a row invalidates the review confirmation.
  await milk.getByLabel('Quantity', { exact: true }).fill('4');
  await expect(draft.getByRole('checkbox')).not.toBeChecked();
  await milk.getByLabel('Quantity', { exact: true }).fill('2');
  await draft.getByRole('checkbox').check();
  await draft.locator('.purchase-draft-scroll').evaluate((el) => {
    el.scrollLeft = 0;
  });
  await draft
    .locator('.purchase-draft-scroll')
    .screenshot({ path: test.info().outputPath('purchase-table-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const scroll = draft.locator('.purchase-draft-scroll');
  expect(await scroll.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await scroll.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await scroll.screenshot({ path: test.info().outputPath('purchase-table-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  await draft.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(draft).not.toBeVisible();
  const orders = await page.request.get('/api/purchases').then((r) => r.json());
  expect(orders).toHaveLength(1);
  expect(orders[0].supplier_reference).toBe(generatedReference + '-EDIT');
  expect(orders[0]).toMatchObject({ status: 'draft', total: '19.70' });
  const stock = await page.request.get('/api/products').then((r) => r.json());
  expect(stock.every((p: any) => p.stock === '0.000' && p.price === '10.00')).toBe(true);
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit purchase draft', exact: true });
  await expect(edit.getByRole('table', { name: 'Purchase items' })).toBeVisible();
  await edit
    .getByRole('row', { name: 'Purchase row 2', exact: true })
    .getByLabel('Quantity', { exact: true })
    .fill('4');
  await edit.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(edit).not.toBeVisible();
  await page.goto('/purchases');
  const search = page.getByRole('textbox', { name: 'Search purchase orders', exact: true });
  await search.fill(generatedReference.toLowerCase());
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await search.fill('unknown-reference-does-not-exist');
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await search.fill('');
  await page.getByLabel('Language', { exact: true }).selectOption('ru');
  await page.getByRole('button', { name: 'Новый заказ поставщику' }).click();
  await expect(page.getByRole('button', { name: 'Прочитать документ поставщика' })).toBeVisible();
  expect(errors).toEqual([]);
});
