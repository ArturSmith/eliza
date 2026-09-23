import { test, expect } from '@playwright/test';
import sharp from 'sharp';
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
test('scans, edits, saves, and reopens a digital invoice inside Eliza AI', async ({ page }) => {
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
  let record: any = null;
  const conversation = { id: '17bf1957-f17b-4e22-9c29-a67757292e60', title: 'Invoice', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  let messages: any[] = [];
  await page.route('**/api/ai/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/messages/stream')) {
      const input = route.request().postDataJSON();
      expect(input.documentId).toBe(id);
      const pair = [
        { id: crypto.randomUUID(), role: 'user', content: input.message, document_id: id, created_at: conversation.created_at },
        { id: crypto.randomUUID(), role: 'assistant', content: 'I scanned the invoice. Review and save the digital document below.', document_id: id, created_at: conversation.created_at },
      ];
      messages.push(...pair);
      return route.fulfill({ contentType: 'text/event-stream', body: 'event: done\ndata: ' + JSON.stringify({ conversation, messages: pair }) + '\n\n' });
    }
    if (pathname.endsWith('/conversations') && route.request().method() === 'POST') return route.fulfill({ json: conversation });
    if (pathname.endsWith('/conversations')) return route.fulfill({ json: [conversation] });
    return route.fulfill({ json: { conversation, messages } });
  });
  await page.route('**/api/documents/**', (route) => {
    if (route.request().method() === 'DELETE') { record = null; return route.fulfill({ json: { deleted: true } }); }
    if (route.request().url().endsWith('/file')) return route.fulfill({ contentType: 'image/png', body: pixel });
    if (route.request().url().endsWith('/save')) {
      record = { ...record, edited: route.request().postDataJSON().data, status: 'saved', version: record.version + 1 };
      return route.fulfill({ json: record });
    }
    return route.fulfill({ json: record });
  });
  await page.route('**/api/documents', (route) => route.fulfill({ json: record ? [{ id, filename: 'invoice.png', documentType: 'Invoice', status: record.status, version: record.version, createdAt: record.createdAt, updatedAt: record.updatedAt }] : [] }));
  await page.route('**/api/documents?*', (route) => route.fulfill({ json: record ? [{ id, filename: 'invoice.png', documentType: 'Invoice', status: record.status, version: record.version, createdAt: record.createdAt, updatedAt: record.updatedAt }] : [] }));
  await page.route('**/api/documents/scan', (route) => {
    expect(route.request().postDataJSON().dataUrl).toMatch(/^data:image\/png;base64,/);
    record = { id, filename: 'invoice.png', mimeType: 'image/png', documentType: 'Invoice', status: 'draft', extracted: source, edited: structuredClone(source), validation: { rowSum: '9192.00', printedTotal: '8638.00', difference: '554.00', warnings: [] }, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    return route.fulfill({ json: record });
  });
  await page.goto('/ai');
  await page.locator('input[type="file"][aria-label="Upload document"]').setInputFiles({ name: 'invoice.png', mimeType: 'image/png', buffer: pixel });
  await page.getByRole('button', { name: 'Send' }).click();
  const paper = page.locator('.ai-digital-document .document-paper');
  await expect(paper.getByRole('heading', { name: 'Реализация товаров № U2-12670' })).toBeVisible();
  await expect(paper.locator('tbody tr')).toHaveCount(9);
  await expect(page.getByText('Draft digital document')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse document' }).click();
  await expect(paper).toBeHidden();
  await page.getByRole('button', { name: 'Expand document' }).click();
  await expect(paper).toBeVisible();
  await paper.getByLabel('Barcode 1').fill('5449000000996');
  await paper.getByLabel('Category 1').fill('Drinks');
  await paper.getByLabel('Selling unit 1').selectOption('piece');
  await paper.getByLabel('Selling price 1').fill('75');
  await paper.getByLabel('Unit cost 1').fill('59');
  await paper.getByLabel('Tax rate 1').fill('0');
  await paper.getByLabel('Minimum stock 1').fill('0');
  const photo = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#dd3333' } }).jpeg().toBuffer();
  await paper.getByLabel('Product photo 1').setInputFiles({ name: 'product.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect(paper.locator('tbody tr').first().locator('.document-product-image')).toBeVisible();

  await paper.getByLabel('Printed document total').fill('9 192,00');
  await page.getByRole('button', { name: 'Collapse document' }).click();
  await page.getByRole('button', { name: 'Expand document' }).click();
  await expect(paper.getByLabel('Printed document total')).toHaveValue('9 192,00');
  await page.getByRole('button', { name: 'Save digital document' }).click();
  await expect(page.getByText('Saved digital document')).toBeVisible();
  expect(record.edited.tables[0].rows[0].product).toMatchObject({ name: 'Чай Манго', barcode: '5449000000996', category: 'Drinks', price: '75', cost: '59' });
  expect(record.edited.tables[0].rows[0].product.image).toMatch(/^data:image\/jpeg;base64,/);
  await expect(paper).toContainText('9 192,00');
  const thread = page.locator('.ai-thread');
  const composer = page.locator('.ai-composer-wrap');
  await thread.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await expect.poll(async () => {
    const content = await paper.boundingBox();
    const overlay = await composer.boundingBox();
    return !!content && !!overlay && content.y + content.height <= overlay.y - 4;
  }).toBe(true);
  expect(await thread.evaluate((node) => node.getBoundingClientRect().bottom)).toBeGreaterThan((await composer.boundingBox())!.y);
  expect(await thread.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('floating-composer.png') });
  expect(await page.request.get('/api/purchases').then((response) => response.json())).toHaveLength(0);
  await page.reload();
  await expect(page.locator('.ai-digital-document .document-paper')).toContainText('9 192,00');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.ai-digital-document .document-paper')).toBeVisible();
  const pdf = await page.pdf();
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('button', { name: 'Close document' }).click();
  await page.getByRole('button', { name: 'Digital documents' }).click();
  await page.getByRole('button', { name: 'invoice.png' }).last().click();
  await expect(page.locator('.ai-digital-document .document-paper tbody tr')).toHaveCount(9);
  await page.goto('/documents?id=' + id);
  await expect(page).toHaveURL(/\/ai\?document=/);
  await expect(page.locator('.ai-digital-document .document-paper')).toContainText('9 192,00');
  await page.goto('/digital-purchases');
  await expect(page.getByRole('heading', { name: 'Digital purchases' })).toBeVisible();
  await expect(page.getByRole('link', { name: /invoice.png/ }).last()).toBeVisible();
  await page.getByLabel('Search digital purchases').fill('invoice');
  await expect(page.getByRole('link', { name: /invoice.png/ }).last()).toBeVisible();
  await page.getByRole('link', { name: /invoice.png/ }).last().click();
  await expect(page).toHaveURL(/\/digital-purchases\?id=/);
  await expect(page.locator('.document-paper')).toContainText('9 192,00');
  await expect(page.getByRole('link', { name: 'Open in Eliza AI' })).toHaveAttribute('href', '/ai?document=' + id);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Delete digital purchase?' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete digital purchase', exact: true }).click();
  await expect(page.getByText('No digital purchases yet. Upload a supplier document in Eliza AI to get started.')).toBeVisible();
});
