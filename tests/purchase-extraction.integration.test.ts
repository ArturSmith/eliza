import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';

const originalUrl = process.env.DATABASE_URL;
const originalKey = process.env.OPENAI_API_KEY;
const admin = new Database();
const name = `eliza_extract_test_${Date.now()}`;
let db: Database, app: Awaited<ReturnType<typeof createApp>>, url: string;
const realFetch = globalThis.fetch;
let cookies = '',
  supplierId = '',
  productId = '',
  storeId = '';
let providerCalls = 0;
const sourceLine = {
  description: 'Test milk',
  supplierSku: 'SUP-1',
  barcode: '',
  quantity: '2',
  unitCost: '3.50',
};
const payload = (lines = [sourceLine]) => ({
  supplierName: 'Test supplier',
  supplierCode: 'SUP',
  supplierCompanyNumber: '',
  supplierPhone: '+7 (969) 722-22-22',
  contactName: 'M-7 S. Mohamad',
  contactPhone: '89292088095',
  supplierReference: 'INV-42',
  documentDate: '2026-09-16',
  lines,
});
let provider: () => Response;
const response = (data: unknown, finish_reason = 'stop') =>
  new Response(
    JSON.stringify({ choices: [{ finish_reason, message: { content: JSON.stringify(data) } }] }),
  );
async function request(path: string, body?: unknown, authenticated = true) {
  const res = await realFetch(url + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: 'http://localhost:5173',
      'X-Eliza-Request': '1',
      'Content-Type': 'application/json',
      Cookie: authenticated ? cookies : '',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (res.headers.getSetCookie().length)
    cookies = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
  return { status: res.status, body: await res.json() };
}
const image = 'data:image/png;base64,' + 'A'.repeat(160000);
const extract = () => request('/purchases/extract', { supplierId, image });
beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE ${name}`);
  const parsed = new URL(originalUrl ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza');
  parsed.pathname = '/' + name;
  process.env.DATABASE_URL = parsed.toString();
  execFileSync(process.execPath, ['apps/api/dist/migrate.js'], { env: process.env });
  db = new Database();
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
  expect(
    (
      await request('/auth/setup', {
        storeName: 'Extract test',
        ownerName: 'Owner',
        email: 'extract@test.example',
        password: 'test-password-12345',
        currency: 'NOK',
        timezone: 'Europe/Oslo',
      })
    ).status,
  ).toBe(201);
  supplierId = (
    await request('/suppliers', {
      requestId: crypto.randomUUID(),
      code: 'SUP',
      name: 'Test supplier',
    })
  ).body.id;
  productId = (
    await request('/products', {
      name: 'Test milk',
      sku: 'MILK',
      category: 'Dairy',
      unit: 'piece',
      price: '10',
      cost: '3',
      minStock: '0',
      barcodes: ['123456789'],
      plu: '',
    })
  ).body.id;
  storeId = (await db.pool.query('SELECT store_id FROM products WHERE id=$1', [productId])).rows[0]
    .store_id;
  await db.pool.query(
    "INSERT INTO supplier_products(store_id,supplier_id,product_id,supplier_sku,pack_cost) VALUES($1,$2,$3,'SUP-1',3)",
    [storeId, supplierId, productId],
  );
  vi.stubGlobal('fetch', async (input: any, init: any) => {
    if (String(input) === 'https://api.openai.com/v1/chat/completions') {
      providerCalls++;
      return provider();
    }
    return realFetch(input, init);
  });
});
beforeEach(async () => {
  process.env.OPENAI_API_KEY = 'test-only-key';
  providerCalls = 0;
  provider = () => response(payload());
  await db.pool.query("DELETE FROM auth_attempts WHERE key LIKE 'ai-extract:%'");
});
afterAll(async () => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
  if (app) await app.close();
  if (db) await db.onModuleDestroy();
  if (originalUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalUrl;
  await admin.pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.onModuleDestroy();
});
describe.sequential('purchase document extraction', () => {
  it('matches supplier codes and accepts document-sized requests without saving an order or stock', async () => {
    const result = await extract();
    expect(result.status).toBe(201);
    expect(result.body.lines[0]).toMatchObject({
      productId,
      matchedBy: 'supplier-sku',
      quantity: '2',
      unitCost: '3.50',
    });
    expect(providerCalls).toBe(1);
    expect((await db.pool.query('SELECT count(*) FROM purchases')).rows[0].count).toBe('0');
    expect(
      (await db.pool.query('SELECT stock,price FROM products WHERE id=$1', [productId])).rows[0],
    ).toEqual({ stock: '0.000', price: '10.00' });
  });
  it('extracts without a supplier and leaves supplier-only codes unmatched', async () => {
    const result = await request('/purchases/extract', { image });
    expect(result.status).toBe(201);
    expect(result.body.lines[0]).toMatchObject({
      productId: null,
      matchedBy: null,
      supplierSku: 'SUP-1',
    });
    expect(providerCalls).toBe(1);
  });
  it('answers a follow-up question without writing any supplier, product, or purchase', async () => {
    provider = () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'The printed reference is INV-42.' } }],
        }),
      );
    const document = {
      ...payload(),
      supplierCompanyNumber: '',
      supplierPhone: '+7 (969) 722-22-22',
      contactName: 'M-7 S. Mohamad',
      contactPhone: '89292088095',
    };
    const answer = await request('/purchases/document-chat', {
      document,
      question: 'What is the reference?',
      history: [],
    });
    expect(answer.status).toBe(201);
    expect(answer.body).toEqual({ answer: 'The printed reference is INV-42.' });
    expect(providerCalls).toBe(1);
    expect((await db.pool.query('SELECT count(*) FROM purchases')).rows[0].count).toBe('0');
  });
  it('requires authentication and validates a supplier when one is provided', async () => {
    expect((await request('/purchases/extract', { supplierId, image }, false)).status).toBe(401);
    expect(
      (await request('/purchases/extract', { supplierId: crypto.randomUUID(), image })).status,
    ).toBe(404);
    expect(providerCalls).toBe(0);
  });
  it('rejects suppliers from another store, inactive suppliers, and users without purchase permission', async () => {
    const foreignStore = (
      await db.pool.query(
        "INSERT INTO stores(organization_id,name,currency,timezone) SELECT organization_id,'Other shop',currency,timezone FROM stores WHERE id=$1 RETURNING id",
        [storeId],
      )
    ).rows[0].id;
    const foreignSupplier = (
      await db.pool.query(
        "INSERT INTO suppliers(store_id,code,name) VALUES($1,'OTHER','Other supplier') RETURNING id",
        [foreignStore],
      )
    ).rows[0].id;
    expect(
      (await request('/purchases/extract', { supplierId: foreignSupplier, image })).status,
    ).toBe(404);
    await db.pool.query('UPDATE suppliers SET active=false WHERE id=$1', [supplierId]);
    expect((await extract()).status).toBe(404);
    await db.pool.query('UPDATE suppliers SET active=true WHERE id=$1', [supplierId]);
    const saved = (
      await db.pool.query("SELECT id,permissions FROM roles WHERE store_id=$1 AND name='Owner'", [
        storeId,
      ])
    ).rows[0];
    try {
      await db.pool.query("UPDATE roles SET permissions='[]'::jsonb WHERE id=$1", [saved.id]);
      expect((await extract()).status).toBe(403);
    } finally {
      await db.pool.query('UPDATE roles SET permissions=$2::jsonb WHERE id=$1', [
        saved.id,
        JSON.stringify(saved.permissions),
      ]);
    }
    expect(providerCalls).toBe(0);
  });
  it('leaves inactive supplier links and inactive products unmatched', async () => {
    await db.pool.query('UPDATE supplier_products SET active=false WHERE supplier_id=$1', [
      supplierId,
    ]);
    expect((await extract()).body.lines[0].productId).toBeNull();
    await db.pool.query('UPDATE supplier_products SET active=true WHERE supplier_id=$1', [
      supplierId,
    ]);
    await db.pool.query('UPDATE products SET active=false WHERE id=$1', [productId]);
    provider = () => response(payload([{ ...sourceLine, barcode: '123456789' }]));
    expect((await extract()).body.lines[0].productId).toBeNull();
    await db.pool.query('UPDATE products SET active=true WHERE id=$1', [productId]);
  });
  it('preserves different-cost duplicates for review', async () => {
    provider = () => response(payload([sourceLine, { ...sourceLine, unitCost: '8.00' }]));
    const result = await extract();
    expect(result.body.lines).toHaveLength(2);
    expect(result.body.mergedCount).toBe(0);
  });
  it.each(['length', 'content_filter'])(
    'rejects incomplete provider results (%s)',
    async (reason) => {
      provider = () => response(payload(), reason);
      expect((await extract()).status).toBe(503);
    },
  );
  it('rejects refusals and malformed shapes rather than importing partial data', async () => {
    provider = () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: { refusal: 'Cannot read', content: JSON.stringify(payload()) },
            },
          ],
        }),
      );
    expect((await extract()).status).toBe(503);
    provider = () => response({ ...payload(), lines: [{ description: 'Only a name' }] });
    expect((await extract()).status).toBe(503);
  });
  it('rejects oversized and empty line lists without silent truncation', async () => {
    provider = () => response(payload(Array.from({ length: 101 }, () => sourceLine)));
    const result = await extract();
    expect(result.status).toBe(400);
    expect(result.body.message).toContain('more than 100');
    provider = () => response(payload([]));
    expect((await extract()).status).toBe(400);
  });
  it('keeps manual entry available when provider is unavailable or unconfigured', async () => {
    delete process.env.OPENAI_API_KEY;
    expect((await extract()).status).toBe(503);
    expect(providerCalls).toBe(0);
    process.env.OPENAI_API_KEY = 'test-only-key';
    provider = () => new Response('{}', { status: 429 });
    expect((await extract()).status).toBe(503);
  });
  it.each([
    [401, 'invalid_api_key', 'rejected the API key'],
    [429, 'insufficient_quota', 'credits or spending quota'],
    [429, 'credit_balance_exhausted', 'credits or spending quota'],
    [429, 'rate_limit_exceeded', 'rate limit reached'],
    [403, 'permission_denied', 'denied access'],
    [404, 'model_not_found', 'model is unavailable'],
    [400, 'invalid_request_error', 'request settings or uploaded file'],
    [503, 'server_error', 'temporarily unavailable'],
  ])(
    'explains provider HTTP %s / %s without exposing provider prose',
    async (status, code, message) => {
      provider = () =>
        new Response(
          JSON.stringify({
            error: { code, message: 'SECRET API key: test-only-key. Private invoice data.' },
          }),
          { status: Number(status), headers: { 'x-request-id': 'req_test123' } },
        );
      const result = await extract();
      expect(result.status).toBe(503);
      expect(result.body.message).toContain(message);
      expect(result.body.details).toEqual({
        providerStatus: status,
        providerCode: code,
        requestId: 'req_test123',
      });
      expect(JSON.stringify(result.body)).not.toContain('test-only-key');
      expect(JSON.stringify(result.body)).not.toContain('Private invoice');
    },
  );
  it('handles non-JSON provider errors and excludes invalid diagnostic fields', async () => {
    provider = () => new Response('<html>Bad gateway</html>', { status: 502 });
    const gateway = await extract();
    expect(gateway.body.message).toContain('temporarily unavailable');
    expect(gateway.body.details).toEqual({ providerStatus: 502 });
    provider = () =>
      new Response(JSON.stringify({ error: { code: 'sk-secret-key', message: 'SECRET' } }), {
        status: 400,
        headers: { 'x-request-id': 'sk-secret-key' },
      });
    expect((await extract()).body.details).toEqual({ providerStatus: 400 });
  });
  it('distinguishes a timeout from a network failure', async () => {
    provider = () => {
      throw new DOMException('SECRET', 'TimeoutError');
    };
    expect((await extract()).body.details.providerCode).toBe('request_timeout');
    provider = () => {
      throw new TypeError('SECRET connection string');
    };
    const result = await extract();
    expect(result.body.details.providerCode).toBe('connection_error');
    expect(result.body.message).toContain('could not connect');
    expect(JSON.stringify(result.body)).not.toContain('SECRET');
  });
  it('limits provider calls per store and retains the ordinary endpoint body limit', async () => {
    for (let i = 0; i < 6; i++) expect((await extract()).status).toBe(201);
    expect((await extract()).status).toBe(429);
    expect(providerCalls).toBe(6);
    expect((await request('/purchases', { notes: 'x'.repeat(110000) })).status).toBe(413);
    expect(
      (
        await request('/purchases/extract', {
          supplierId,
          image: 'data:image/png;base64,' + 'A'.repeat(6400000),
        })
      ).status,
    ).toBe(413);
  });
});
