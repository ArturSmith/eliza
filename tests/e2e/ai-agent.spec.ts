import { test, expect } from '@playwright/test';
const conversationId = 'a135a4b1-9217-4b6d-8412-1cb1e6f4182c';
const documentId = 'b13a452a-6a6e-4b8f-9300-09b831dbe202';
const now = new Date().toISOString();
const conversation = {
  id: conversationId,
  title: 'Sales this month',
  created_at: now,
  updated_at: now,
};
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=',
  'base64',
);
test('asks Eliza AI, displays a sales table, reopens history and attaches a document', async ({
  page,
}) => {
  await page.goto('/');
  const setup = await page.request.get('/api/auth/status').then((response) => response.json());
  if (setup.needsSetup) {
    await page.getByLabel('Store name', { exact: true }).fill('AI test shop');
    await page.getByLabel('Your name').fill('Owner');
  }
  await page.getByLabel('Email address').fill('ai-ui@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page
    .getByRole('button', { name: setup.needsSetup ? 'Create my store' : 'Sign in' })
    .click();
  await expect(page.getByRole('link', { name: 'Eliza AI' })).toBeVisible();
  let messages: any[] = [];
  let exists = false;
  let sentDocument = '';
  await page.route('**/api/ai/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/ai/conversations') && route.request().method() === 'GET')
      return route.fulfill({ json: exists ? [conversation] : [] });
    if (pathname.endsWith('/ai/conversations') && route.request().method() === 'POST') {
      exists = true;
      return route.fulfill({ json: conversation });
    }
    if (pathname.endsWith('/messages/stream')) {
      const body = route.request().postDataJSON();
      sentDocument = body.documentId ?? '';
      const generated = [
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: body.message,
          document_id: body.documentId ?? null,
          created_at: now,
        },
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: body.documentId
            ? 'Invoice received. Review /documents?id=' + documentId
            : '**Sales by month:**\n- **Net sales:** 42 NOK\n| Month | Sales |\n| --- | --- |\n| September | 42 NOK |',
          document_id: body.documentId ?? null,
          created_at: now,
        },
      ];
      messages.push(...generated);
      const text = generated[1].content;
      const events =
        'event: delta\ndata: ' + JSON.stringify({ text: text.slice(0, 12) }) + '\n\n' +
        'event: delta\ndata: ' + JSON.stringify({ text: text.slice(12) }) + '\n\n' +
        'event: done\ndata: ' + JSON.stringify({ conversation, messages: generated }) + '\n\n';
      return route.fulfill({ body: events, contentType: 'text/event-stream' });
    }
    return route.fulfill({ json: { conversation, messages } });
  });
  const digital = {
    id: documentId, filename: 'invoice.png', mimeType: 'image/png', documentType: 'Invoice', status: 'draft', version: 1,
    extracted: { documentType: 'Invoice', language: 'en', title: 'Invoice', number: '1', date: '', currency: 'NOK', summary: '', pages: 1, parties: [], fields: [], sections: [], tables: [], additionalText: [], annotations: [], printedTotal: '', extractionWarnings: [] },
    validation: { rowSum: null, printedTotal: null, difference: null, warnings: [] },
    createdAt: now, updatedAt: now,
  };
  await page.route('**/api/documents/**', (route) => route.request().url().endsWith('/file')
    ? route.fulfill({ contentType: 'image/png', body: pixel })
    : route.fulfill({ json: { ...digital, edited: digital.extracted } }));
  await page.route('**/api/documents/scan', (route) => route.fulfill({ json: { ...digital, edited: digital.extracted } }));
  await page.goto('/ai');
  await expect(page.locator('.ai-header')).toHaveCount(0);
  await expect(page.locator('.ai-thread')).toHaveCSS('top', '0px');
  await expect(page.getByRole('heading', { name: 'How can I help your store?' })).toBeVisible();
  await page.getByLabel('Ask Eliza AI', { exact: true }).fill('Sales this month?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByLabel('Ask Eliza AI', { exact: true })).toBeEmpty();
  await expect(page.getByRole('table')).toContainText('42 NOK');
  await expect(page.locator('.ai-message-assistant strong').first()).toHaveText('Sales by month:');
  await expect(page.locator('.ai-message-assistant li')).toContainText('Net sales: 42 NOK');
  await page.screenshot({ path: test.info().outputPath('eliza-ai-chat.png'), fullPage: true });
  await page.reload();
  await expect(page.getByRole('table')).toContainText('September');
  await page.getByRole('button', { name: 'New conversation' }).last().click();
  await expect(page.getByRole('heading', { name: 'How can I help your store?' })).toBeVisible();
  await page
    .locator('input[type="file"][aria-label="Upload document"]')
    .setInputFiles({ name: 'invoice.png', mimeType: 'image/png', buffer: pixel });
  await page.getByLabel('Ask Eliza AI', { exact: true }).fill('What is in this invoice?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('button', { name: /Open scanned document/ }).first()).toBeVisible();
  expect(sentDocument).toBe(documentId);
});
