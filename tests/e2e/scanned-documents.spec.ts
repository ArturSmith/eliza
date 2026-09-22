import { test, expect } from '@playwright/test';
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=',
  'base64',
);
const source = {
  documentType: 'Invoice',
  language: 'ru',
  title: 'Реализация товаров № U2-12670',
  number: 'U2-12670',
  date: '8 сентября 2026 г.',
  currency: '₽',
  summary: '',
  pages: 1,
  parties: [
    { role: 'Поставщик', name: 'ИП Магомадов Р.А.', details: '' },
    { role: 'Покупатель', name: 'Чир-корт', details: '' },
  ],
  fields: [],
  sections: [],
  additionalText: [],
  annotations: [],
  printedTotal: '8 638,00',
  extractionWarnings: [],
  tables: [
    {
      id: 'items',
      title: 'Товары',
      columns: [
        { key: 'product', label: 'Товар', kind: 'text' },
        { key: 'quantity', label: 'Кол-во', kind: 'quantity' },
        { key: 'amount', label: 'Сумма', kind: 'amount' },
      ],
      rows: [
        ['Чай Манго', '24', '1 416'],
        ['Чай Малина', '24', '1 416'],
        ['Чай Лимон', '24', '1 416'],
        ['Чай Персик', '24', '1 416'],
        ['Энерджи Белая Вишня', '12', '1 056'],
        ['Энерджи Виноград', '12', '1 056'],
        ['САШ Лимон', '1', '288'],
        ['Конфеты Red 500 г', '1', '564'],
        ['Конфеты Red 800 г', '1', '564'],
      ].map((cells, i) => ({ rowNumber: String(i + 1), cells })),
      footerRows: [],
    },
  ],
};
const id = 'b13a452a-6a6e-4b8f-9300-09b831dbe202';
test('scans, edits, saves, and reopens a nine-row digital invoice', async ({ page }) => {
  await page.goto('/');
  const setup = await page.request.get('/api/auth/status').then((response) => response.json());
  if (setup.needsSetup) {
    await page.getByLabel('Store name', { exact: true }).fill('Document shop');
    await page.getByLabel('Your name').fill('Alex');
    await page.getByLabel('Email address').fill('documents@example.test');
    await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
    await page.getByRole('button', { name: 'Create my store' }).click();
  } else {
    await page.getByLabel('Email address').fill('documents@example.test');
    await page.getByLabel('Password').fill('local-test-password-123');
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await expect(page.getByRole('link', { name: 'Purchases', exact: true })).toBeVisible();
  let saved: any = null;
  await page.route('**/api/documents/**', async (route) => {
    if (route.request().url().endsWith('/file'))
      return route.fulfill({ status: 200, contentType: 'image/png', body: pixel });
    if (route.request().url().endsWith('/save')) {
      saved = { ...saved, edited: route.request().postDataJSON().data, version: saved.version + 1 };
      return route.fulfill({ json: saved });
    }
    return route.fulfill({ json: saved });
  });
  await page.route('**/api/documents', async (route) =>
    route.fulfill({
      json: saved
        ? [
            {
              id,
              filename: 'invoice.png',
              documentType: 'Invoice',
              version: saved.version,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ]
        : [],
    }),
  );
  await page.route('**/api/documents/scan', async (route) => {
    expect(route.request().postDataJSON().dataUrl).toMatch(/^data:image\/png;base64,/);
    saved = {
      id,
      filename: 'invoice.png',
      mimeType: 'image/png',
      documentType: 'Invoice',
      extracted: source,
      edited: structuredClone(source),
      validation: {
        rowSum: '9192.00',
        printedTotal: '8638.00',
        difference: '554.00',
        warnings: [],
      },
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await route.fulfill({ json: saved });
  });
  await page.route('**/api/documents/chat', async (route) => {
    expect(route.request().postDataJSON().documentId).toBe(id);
    await route.fulfill({ json: { answer: 'The invoice has nine product rows.' } });
  });
  await page.goto('/documents');
  await expect(page.getByRole('heading', { name: 'What would you like to scan?' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('assistant-welcome.png'), fullPage: true });
  await expect(page.getByRole('heading', { name: 'Previous scans' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Attach document' }).click();
  await expect(page.locator('.document-attach-menu').getByRole('button', { name: 'Choose file' })).toBeVisible();
  await expect(page.locator('.document-attach-menu').getByRole('button', { name: 'Take photo' })).toBeVisible();
  await page.getByRole('button', { name: 'Attach document' }).click();
  await page
    .getByLabel('Choose file')
    .setInputFiles({ name: 'invoice.png', mimeType: 'image/png', buffer: pixel });
  await expect(page.locator('.document-attachment-preview')).toContainText('invoice.png');
  await page.getByRole('button', { name: 'Send' }).click();
  const paper = page.locator('.document-paper');
  await expect(paper.getByRole('heading', { name: 'Реализация товаров № U2-12670' })).toBeVisible();
  await expect(paper.locator('tbody tr')).toHaveCount(9);
  await expect(paper).toContainText('ИП Магомадов Р.А.');
  await expect(paper).toContainText('Чир-корт');
  await expect(paper).toContainText('554 ₽');
  await page.getByLabel('Upload a document or ask anything...').fill('How many rows?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('The invoice has nine product rows.')).toBeVisible();
  await paper.screenshot({ path: test.info().outputPath('digital-invoice.png') });
  await page.getByRole('button', { name: 'Edit document' }).click();
  await paper.getByLabel('Printed document total').fill('9 192,00');
  await expect(paper.getByText('Discrepancy detected')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save corrections' }).click();
  await expect(page.getByRole('button', { name: 'Edit document' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.document-paper')).toContainText('9 192,00');
  await expect(page.locator('.document-paper tbody tr')).toHaveCount(9);
  await page.getByRole('button', { name: 'Previous scans' }).click();
  await expect(page.getByRole('heading', { name: 'Previous scans' })).toBeVisible();
  await expect(page.locator('.document-history')).toContainText('invoice.png');
  await page.getByRole('button', { name: 'Previous scans' }).click();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.document-paper')).toBeVisible();
  const pdf = await page.pdf({ path: test.info().outputPath('digital-invoice.pdf') });
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  await page.emulateMedia({ media: 'screen' });
  saved = { ...saved, version: saved.version + 1, edited: { ...saved.edited, tables: saved.edited.tables.map((table: any) => ({ ...table, expectedRowCount: 31, firstRowNumber: 1, lastRowNumber: 31 })) } };
  await page.reload();
  await expect(page.getByText('Review required').first()).toBeVisible();
  await expect(page.getByText('Extracted 9 of 31 expected rows.', { exact: true })).toBeVisible();
  await expect(page.getByText('This scan has missing or duplicate product rows.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare purchase order' })).toHaveCount(0);
});
