import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
import type { DocumentData } from '../packages/contracts/src/index';
const admin = new Database();
const originalUrl =
  process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const originalKey = process.env.OPENAI_API_KEY;
const originalFetch = globalThis.fetch;
const name = `eliza_documents_test_${Date.now()}`;
let app: Awaited<ReturnType<typeof createApp>>, db: Database, url: string;
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=';
const invoice: DocumentData = {
  documentType: 'invoice',
  language: 'ru',
  title: 'Реализация товаров № U2-12670',
  number: 'U2-12670',
  date: '8 сентября 2026 г.',
  currency: '₽',
  summary: '',
  pages: 1,
  parties: [
    { role: 'Поставщик', name: 'ИП Магомадов Р.А.', details: '+7 (969) 722-22-22' },
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
let providerData: DocumentData = invoice;
let providerInput: any;
let chatInput: any;
class Client {
  cookies = new Map<string, string>();
  async request(path: string, body?: unknown) {
    const response = await originalFetch(url + '/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        'X-Eliza-Request': '1',
        'Content-Type': 'application/json',
        Cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [key, value] = cookie.split(';')[0].split('=');
      if (value) this.cookies.set(key, value);
    }
    return { status: response.status, body: await response.json().catch(() => null) };
  }
}
const owner = new Client();
beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE ${name}`);
  const parsed = new URL(originalUrl);
  parsed.pathname = '/' + name;
  process.env.DATABASE_URL = parsed.toString();
  process.env.OPENAI_API_KEY = 'test-only-key';
  execFileSync(process.execPath, ['apps/api/dist/migrate.js'], { env: process.env });
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === 'https://api.openai.com/v1/responses') {
      providerInput = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: [{ content: [{ type: 'output_text', text: JSON.stringify(providerData) }] }],
        }),
        { status: 200 },
      );
    }
    if (String(input) === 'https://api.openai.com/v1/chat/completions') {
      chatInput = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'The document has 9 rows.' } }] }), { status: 200 });
    }
    return originalFetch(input, init);
  };
  db = new Database();
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});
afterAll(async () => {
  globalThis.fetch = originalFetch;
  if (app) await app.close();
  if (db) await db.onModuleDestroy();
  process.env.DATABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
  await admin.pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.onModuleDestroy();
});
describe.sequential('scanned document persistence and access', () => {
  let id = '';
  it('scans the nine-row invoice and keeps the 554-ruble discrepancy', async () => {
    expect(
      (
        await owner.request('/auth/setup', {
          storeName: 'Document shop',
          ownerName: 'Owner',
          email: 'docs@example.test',
          password: 'owner-password-12345',
          currency: 'NOK',
          timezone: 'Europe/Oslo',
        })
      ).status,
    ).toBe(201);
    const result = await owner.request('/documents/scan', {
      filename: 'invoice.png',
      dataUrl: png,
    });
    expect(result.status).toBe(201);
    expect(providerInput.input[0].content[1].type).toBe('input_image');
    expect(providerInput.input[0].content[1].image_url).toBe(png);
    expect(result.body.extracted.tables[0].rows).toHaveLength(9);
    expect(result.body.validation).toMatchObject({
      rowSum: '9192.00',
      printedTotal: '8638.00',
      difference: '554.00',
    });
    id = result.body.id;
  });
  it('answers a question about the saved document and rejects inaccessible ids', async () => {
    const result = await owner.request('/documents/chat', {
      documentId: id,
      question: 'How many rows are there?',
      history: [],
    });
    expect(result.status).toBe(201);
    expect(result.body.answer).toBe('The document has 9 rows.');
    expect(chatInput.messages[1].content).toContain('Чай Манго');
    const missing = await owner.request('/documents/chat', {
      documentId: '00000000-0000-4000-8000-000000000001',
      question: 'Read this document',
    });
    expect(missing.status).toBe(404);
  });
  it('saves a correction while preserving the original extraction and reopens it', async () => {
    const current = (await owner.request('/documents/' + id)).body;
    const edited = structuredClone(current.edited);
    edited.printedTotal = '9 192,00';
    const saved = await owner.request('/documents/' + id + '/save', {
      data: edited,
      version: current.version,
    });
    expect(saved.status).toBe(201);
    expect(saved.body.validation.difference).toBe('0.00');
    expect(saved.body.extracted.printedTotal).toBe('8 638,00');
    const reopened = await owner.request('/documents/' + id);
    expect(reopened.body.edited.printedTotal).toBe('9 192,00');
    expect(
      (
        await owner.request('/documents/' + id + '/save', {
          data: edited,
          version: current.version,
        })
      ).status,
    ).toBe(409);
  });
  it('restricts the original file to authenticated users', async () => {
    const own = await originalFetch(url + '/api/documents/' + id + '/file', {
      headers: { Cookie: [...owner.cookies].map(([key, value]) => `${key}=${value}`).join('; ') },
    });
    expect(own.status).toBe(200);
    expect(own.headers.get('content-type')).toContain('image/png');
    const anonymous = await originalFetch(url + '/api/documents/' + id + '/file');
    expect(anonymous.status).toBe(401);
  });
  it('accepts a PDF with no table without fabricating invoice rows', async () => {
    providerData = {
      ...invoice,
      documentType: 'letter',
      title: 'Delivery notice',
      number: '',
      printedTotal: '',
      tables: [],
      sections: [{ title: 'Notice', text: 'Delivery delayed.' }],
    };
    const pdf =
      'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n1 0 obj\n').toString('base64');
    const result = await owner.request('/documents/scan', { filename: 'notice.pdf', dataUrl: pdf });
    expect(result.status).toBe(201);
    expect(providerInput.input[0].content[1].type).toBe('input_file');
    expect(providerInput.input[0].content[1].file_data).toBe(pdf);
    expect(result.body.edited.tables).toEqual([]);
    expect(result.body.validation.rowSum).toBe(null);
  });
});
