import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
import { extractScannedDocument } from '../apps/api/src/scanned-document-vision';
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
let visionRequests: any[] = [];
let chatInput: any;
let denseMode: 'complete' | 'partial' | 'multipage' | '' = '';
let forceIncomplete = false;
let sectionIndex = 0;
const denseRows = Array.from({ length: 31 }, (_, index) => {
  const number = index + 1;
  const quantity = number === 10 ? '10' : '1';
  const price = number === 10 ? '65.00' : number === 31 ? '569.00' : '1000.00';
  const amount = number === 10 ? '650.00' : number === 31 ? '569.00' : '1000.00';
  return { rowNumber: String(number), cells: [`Арт-${String(number).padStart(3, '0')}`, number === 10 ? 'UNO' : `Товар ${number}`, quantity, 'шт', price, amount], uncertainCells: [] };
});
const denseInvoice: DocumentData = {
  ...invoice, number: '9605', title: 'Реализация товаров № 9605', printedTotal: '30219.00',
  tables: [{ id: 'items', title: 'Товары', columns: [
    { key: 'article', label: 'Артикул', kind: 'text' },
    { key: 'product', label: 'Товар', kind: 'text' },
    { key: 'quantity', label: 'Количество', kind: 'quantity' },
    { key: 'unit', label: 'Ед.', kind: 'text' },
    { key: 'price', label: 'Цена', kind: 'price' },
    { key: 'amount', label: 'Сумма', kind: 'amount' },
  ], rows: denseRows.slice(0, 25).map((row) => row.rowNumber === '10' ? { ...row, cells: ['Арт-010', 'Incorrect UNO', '1', 'шт', '650.00', '650.00'] } : row), footerRows: [] }],
};
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
      visionRequests.push(providerInput);
      const schemaName = providerInput.text.format.name;
      let output: unknown = providerData;
      if (denseMode) {
        if (schemaName === 'document_layout') output = denseMode === 'multipage'
          ? { expectedRowCount: null, firstRowNumber: null, lastRowNumber: null, tableTitle: '', tableCount: 0, warnings: [] }
          : { expectedRowCount: 31, firstRowNumber: 1, lastRowNumber: 31, tableTitle: 'Товары', tableCount: 1, warnings: [] };
        else if (schemaName === 'scanned_document') output = denseMode === 'multipage' ? { ...invoice, documentType: 'letter', pages: 2, title: 'Two-page notice', tables: [], printedTotal: '', sections: [{ title: 'Notice', text: 'Delivery delayed.' }] } : denseInvoice;
        else if (schemaName === 'document_rows') {
          const segments = denseMode === 'complete' ? [[1, 10], [9, 18], [17, 25], [24, 31]] : [[1, 10], [9, 18], [17, 25], [20, 25]];
          const [first, last] = segments[sectionIndex++];
          output = { rows: denseRows.filter((row) => Number(row.rowNumber) >= first && Number(row.rowNumber) <= last) };
        }
      }
      return new Response(JSON.stringify(forceIncomplete ? { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] } : { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(output) }] }] }), { status: 200 });
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
  it('keeps a new scan as a draft until a user saves it', async () => {
    const current = (await owner.request('/documents/' + id)).body;
    expect(current.status).toBe('draft');
    const matches = await owner.request('/documents?search=invoice.png');
    expect(matches.body.some((item: { id: string; status: string }) => item.id === id && item.status === 'draft')).toBe(true);
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
    expect(saved.body.status).toBe('saved');
    expect(saved.body.extracted.printedTotal).toBe('8 638,00');
    const reopened = await owner.request('/documents/' + id);
    expect(reopened.body.edited.printedTotal).toBe('9 192,00');
    const byNumber = await owner.request('/documents?search=U2-12670');
    expect(byNumber.body.some((item: { id: string; status: string }) => item.id === id && item.status === 'saved')).toBe(true);
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
  it('suggests pack count and box cost while preserving printed invoice values', async () => {
    const boxed = structuredClone(invoice);
    boxed.printedTotal = '240,00';
    boxed.tables[0].columns = [
      { key: 'product', label: 'Товар', kind: 'text' },
      { key: 'quantity', label: 'Количество', kind: 'quantity' },
      { key: 'price', label: 'Цена', kind: 'price' },
      { key: 'amount', label: 'Сумма', kind: 'amount' },
    ];
    boxed.tables[0].rows = [{
      rowNumber: '1', cells: ['Конфеты 24шт в уп', '2 короб', '120,00', '240,00'],
    }];
    providerData = boxed;
    try {
      const result = await extractScannedDocument(
        png, 'boxed.png', 'image/png', Buffer.from(png.split(',')[1], 'base64'),
      );
      expect(result.tables[0].rows[0]).toMatchObject({
        cells: ['Конфеты 24шт в уп', '2 короб', '120,00', '240,00'],
        product: { itemsPerBox: '24', boxCost: '120.00', cost: '' },
      });
    } finally {
      providerData = invoice;
    }
  });
  it('recovers all 31 numbered rows from overlapping high-resolution sections', async () => {
    denseMode = 'complete'; sectionIndex = 0; visionRequests = [];
    const bytes = await sharp({ create: { width: 1200, height: 1800, channels: 3, background: '#fff' } }).png().toBuffer();
    const result = await owner.request('/documents/scan', { filename: 'invoice-9605.png', dataUrl: 'data:image/png;base64,' + bytes.toString('base64') });
    denseMode = '';
    expect(result.status).toBe(201);
    expect(sectionIndex).toBe(4);
    const crops = visionRequests.filter((request) => request.text.format.name === 'document_rows');
    expect(crops).toHaveLength(4);
    for (const cropRequest of crops) {
      const cropUrl: string = cropRequest.input[0].content[2].image_url;
      const cropMeta = await sharp(Buffer.from(cropUrl.split(',')[1], 'base64')).metadata();
      expect(cropMeta.width).toBe(1200);
      expect(cropMeta.height).toBeGreaterThanOrEqual(450);
    }
    const original = await originalFetch(url + '/api/documents/' + result.body.id + '/file', { headers: { Cookie: [...owner.cookies].map(([key, value]) => `${key}=${value}`).join('; ') } });
    expect(Buffer.from(await original.arrayBuffer())).toEqual(bytes);
    expect(result.body.extracted.number).toBe('9605');
    expect(result.body.extracted.tables[0].rows).toHaveLength(31);
    expect(result.body.extracted.tables[0].rows[9].cells).toEqual(['Арт-010', 'UNO', '10', 'шт', '65.00', '650.00']);
    expect(result.body.extracted.tables[0].rows.at(-1).rowNumber).toBe('31');
    expect(result.body.validation).toMatchObject({ expectedRows: 31, extractedRows: 31, incomplete: true, rowSum: '30219.00', printedTotal: '30219.00', difference: '0.00' });
    const persisted = await owner.request('/documents/' + result.body.id);
    expect(persisted.body.extracted.tables[0].rows).toHaveLength(31);
  });
  it('marks 25 of 31 rows incomplete and treats totals as partial', async () => {
    denseMode = 'partial'; sectionIndex = 0;
    const bytes = await sharp({ create: { width: 1200, height: 1800, channels: 3, background: '#fff' } }).png().toBuffer();
    const result = await owner.request('/documents/scan', { filename: 'partial-9605.png', dataUrl: 'data:image/png;base64,' + bytes.toString('base64') });
    denseMode = '';
    expect(result.status).toBe(201);
    expect(result.body.extracted.tables[0].rows).toHaveLength(25);
    expect(result.body.validation).toMatchObject({ expectedRows: 31, extractedRows: 25, incomplete: true, missingRowNumbers: [26, 27, 28, 29, 30, 31], arithmeticStatus: 'incomplete' });
    expect(result.body.validation.warnings.join(' ')).toContain('Partial extracted row sum');
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
    expect(providerInput.input[0].content[1].detail).toBe('high');
    expect(result.body.edited.tables).toEqual([]);
    expect(result.body.validation.rowSum).toBe(null);
  });
  it('uses high PDF detail for a multi-page non-table document', async () => {
    denseMode = 'multipage'; sectionIndex = 0;
    const bytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(110_000, 32)]);
    const result = await owner.request('/documents/scan', { filename: 'two-pages.pdf', dataUrl: 'data:application/pdf;base64,' + bytes.toString('base64') });
    denseMode = '';
    expect(result.status).toBe(201);
    expect(result.body.edited.pages).toBe(2);
    expect(result.body.edited.tables).toEqual([]);
    expect(providerInput.input[0].content[1].detail).toBe('high');
    expect(sectionIndex).toBe(0);
  });
  it('does not save a truncated model response', async () => {
    await db.pool.query("DELETE FROM auth_attempts WHERE key LIKE 'ai-universal-scan:%'");
    const before = (await db.pool.query('SELECT count(*)::int AS count FROM scanned_documents')).rows[0].count;
    forceIncomplete = true;
    const result = await owner.request('/documents/scan', { filename: 'truncated.png', dataUrl: png });
    forceIncomplete = false;
    expect(result.status).toBe(503);
    expect((await db.pool.query('SELECT count(*)::int AS count FROM scanned_documents')).rows[0].count).toBe(before);
  });
});
