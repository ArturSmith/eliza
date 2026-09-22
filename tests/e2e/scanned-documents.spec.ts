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
  await paper.getByLabel('Printed document total').fill('9 192,00');
  await page.getByRole('button', { name: 'Save digital document' }).click();
  await expect(page.getByText('Saved digital document')).toBeVisible();
  await expect(paper).toContainText('9 192,00');
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
});
