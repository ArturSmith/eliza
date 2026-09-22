import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
import { hash, passwordHash } from '../apps/api/dist/security.js';
const admin = new Database();
const base = process.env.DATABASE_URL ?? 'postgresql://eliza:eliza_local@127.0.0.1:54329/eliza';
const originalKey = process.env.OPENAI_API_KEY;
const originalFetch = globalThis.fetch;
const name = 'eliza_ai_test_' + Date.now();
let app: Awaited<ReturnType<typeof createApp>>, db: Database, url: string;
let providerCalls: any[] = [];
let replies: Array<any> = [];
const answer = (text: string) => ({
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
});
const call = (name: string, args: unknown) => ({
  status: 'completed',
  output: [
    {
      type: 'function_call',
      name,
      arguments: JSON.stringify(args),
      call_id: 'call_' + Math.random(),
    },
  ],
});
class Client {
  cookies = new Map<string, string>();
  async request(path: string, body?: unknown) {
    const response = await originalFetch(url + '/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        'X-Eliza-Request': '1',
        'Content-Type': 'application/json',
        Cookie: [...this.cookies].map(([k, v]) => k + '=' + v).join('; '),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [k, v] = cookie.split(';')[0].split('=');
      if (v) this.cookies.set(k, v);
    }
    return { status: response.status, body: await response.json().catch(() => null) };
  }
}
const owner = new Client(),
  outsider = new Client(),
  sameStoreOther = new Client();
let conversationId = '',
  storeId = '',
  scannedId = '';
beforeAll(async () => {
  await admin.pool.query('CREATE DATABASE ' + name);
  const parsed = new URL(base);
  parsed.pathname = '/' + name;
  process.env.DATABASE_URL = parsed.toString();
  process.env.OPENAI_API_KEY = 'test-only-key';
  execFileSync(process.execPath, ['apps/api/dist/migrate.js'], { env: process.env });
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== 'https://api.openai.com/v1/responses') return originalFetch(input, init);
    providerCalls.push(JSON.parse(String(init?.body)));
    const next = replies.shift();
    if (!next) throw new Error('Unexpected provider call');
    if (next.statusCode)
      return new Response(JSON.stringify({ error: { code: 'server_error' } }), {
        status: next.statusCode,
      });
    if (providerCalls.at(-1).stream) {
      const text = next.output?.filter((item: any) => item.type === 'message')
        .flatMap((item: any) => item.content ?? []).map((item: any) => item.text ?? '').join('') ?? '';
      return new Response(
        (text ? 'event: response.output_text.delta\ndata: ' + JSON.stringify({ type: 'response.output_text.delta', delta: text }) + '\n\n' : '') +
        'event: response.completed\ndata: ' + JSON.stringify({ type: 'response.completed', response: next }) + '\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    }
    return new Response(JSON.stringify(next), { status: 200 });
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
  process.env.DATABASE_URL = base;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
  await admin.pool.query('DROP DATABASE IF EXISTS ' + name + ' WITH (FORCE)');
  await admin.onModuleDestroy();
});
describe.sequential('Eliza AI conversations', () => {
  it('requires login and creates an employee-owned conversation', async () => {
    expect((await outsider.request('/ai/conversations')).status).toBe(401);
    expect(
      (
        await owner.request('/auth/setup', {
          storeName: 'AI Shop',
          ownerName: 'Owner',
          email: 'ai-owner@example.test',
          password: 'owner-password-12345',
          currency: 'NOK',
          timezone: 'Europe/Oslo',
        })
      ).status,
    ).toBe(201);
    const store = (await db.pool.query('SELECT id FROM stores LIMIT 1')).rows[0];
    storeId = store.id;
    const created = await owner.request('/ai/conversations', {});
    expect(created.status).toBe(201);
    conversationId = created.body.id;
    expect((await owner.request('/ai/conversations')).body).toHaveLength(1);
  });
  it('streams answer chunks and saves the completed answer', async () => {
    replies = [answer('Streaming answer.')];
    const response = await originalFetch(url + '/api/ai/conversations/' + conversationId + '/messages/stream', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        'X-Eliza-Request': '1',
        'Content-Type': 'application/json',
        Cookie: [...owner.cookies].map(([k, v]) => k + '=' + v).join('; '),
      },
      body: JSON.stringify({ message: 'Stream a response.' }),
    });
    expect(response.status).toBe(201);
    const events = await response.text();
    expect(events).toContain('event: delta');
    expect(events).toContain('Streaming answer.');
    expect(events).toContain('event: done');
    expect(providerCalls.at(-1).stream).toBe(true);
    expect((await owner.request('/ai/conversations/' + conversationId)).body.messages.at(-1).content).toBe('Streaming answer.');
  });
  it('uses the Responses function loop and persists follow-up context', async () => {
    const account = (
      await db.pool.query(
        'SELECT e.id AS employee_id,d.id AS device_id FROM employees e JOIN devices d ON d.store_id=e.store_id WHERE e.store_id=$1 LIMIT 1',
        [storeId],
      )
    ).rows[0];
    const shift = (
      await db.pool.query(
        "INSERT INTO shifts(store_id,device_id,employee_id,status,opening_cash,notes,request_id,request_hash) VALUES($1,$2,$3,'open',0,'',gen_random_uuid(),'test') RETURNING id",
        [storeId, account.device_id, account.employee_id],
      )
    ).rows[0];
    await db.pool.query(
      "INSERT INTO sales(store_id,device_id,employee_id,shift_id,request_id,request_hash,receipt_number,total,tax,discount,receipt) VALUES($1,$2,$3,$4,gen_random_uuid(),'test','AI-1',42,0,0,$5)",
      [storeId, account.device_id, account.employee_id, shift.id, JSON.stringify({ lines: [] })],
    );
    replies = [
      call('sales_summary', { from: '2026-09-01', to: '2026-09-30' }),
      answer('The store sold 42 NOK this month.'),
    ];
    const first = await owner.request('/ai/conversations/' + conversationId + '/messages', {
      message: 'How much did I sell this month?',
    });
    expect(first.status).toBe(201);
    expect(first.body.messages).toHaveLength(2);
    expect(providerCalls.at(-1).input.at(-1)).toMatchObject({
      type: 'function_call_output',
      output: expect.stringContaining('42.00'),
    });
    expect(providerCalls.at(-2).store).toBe(false);
    expect(providerCalls.at(-2).tools.some((tool: any) => tool.name === 'sales_summary')).toBe(
      true,
    );
    replies = [
      call('sales_summary', { from: '2026-08-01', to: '2026-08-31' }),
      answer('There were no sales last month.'),
    ];
    const second = await owner.request('/ai/conversations/' + conversationId + '/messages', {
      message: 'What about last month?',
    });
    expect(second.status).toBe(201);
    const earlier = providerCalls.at(-2).input;
    expect(earlier).toContainEqual({ role: 'user', content: 'How much did I sell this month?' });
    expect(earlier).toContainEqual({
      role: 'assistant',
      content: 'The store sold 42 NOK this month.',
    });
    expect((await owner.request('/ai/conversations/' + conversationId)).body.messages).toHaveLength(
      6,
    );
  });
  it('retrieves a scan but labels it unverified and preserves its document reference', async () => {
    const person = (
      await db.pool.query('SELECT id FROM employees WHERE store_id=$1 LIMIT 1', [storeId])
    ).rows[0];
    const device = (
      await db.pool.query('SELECT id FROM devices WHERE store_id=$1 LIMIT 1', [storeId])
    ).rows[0];
    const document = {
      number: '9605',
      title: 'Invoice 9605',
      tables: [{ rows: [{ rowNumber: '1', cells: ['Apple', '10'] }] }],
    };
    scannedId = (
      await db.pool.query(
        "INSERT INTO scanned_documents(store_id,created_by,device_id,filename,mime_type,original_file,extracted,edited,validation,document_type) VALUES($1,$2,$3,'invoice.png','image/png',$4,$5,$5,'{}','invoice') RETURNING id",
        [storeId, person.id, device.id, Buffer.from([137, 80, 78, 71]), JSON.stringify(document)],
      )
    ).rows[0].id;
    replies = [
      call('search_documents', { query: '9605' }),
      call('document_details', { id: scannedId }),
      answer('Invoice 9605 is an unverified scan with one row. Open /documents?id=' + scannedId),
    ];
    const result = await owner.request('/ai/conversations/' + conversationId + '/messages', {
      message: 'Find invoice 9605 and list its products.',
    });
    expect(result.status).toBe(201);
    expect(result.body.messages[1].document_id).toBe(scannedId);
    const outputs = providerCalls
      .slice(-2)
      .flatMap((v) => v.input.filter((item: any) => item.type === 'function_call_output'));
    expect(outputs.some((item: any) => item.output.includes('"verified":false'))).toBe(true);
  });
  it('rejects invalid tool arguments and model-supplied store IDs', async () => {
    replies = [
      call('search_products', { query: 'Apple', storeId: 'other-store' }),
      answer('I could not perform that search.'),
    ];
    const result = await owner.request('/ai/conversations/' + conversationId + '/messages', {
      message: 'Find apples.',
    });
    expect(result.status).toBe(201);
    expect(providerCalls.at(-1).input.at(-1).output).toContain('Invalid tool arguments');
  });
  it('does not persist a failed provider answer and allows retry', async () => {
    const before = (await owner.request('/ai/conversations/' + conversationId)).body.messages
      .length;
    replies = [{ statusCode: 503 }];
    expect(
      (
        await owner.request('/ai/conversations/' + conversationId + '/messages', {
          message: 'Try later.',
        })
      ).status,
    ).toBe(503);
    expect((await owner.request('/ai/conversations/' + conversationId)).body.messages).toHaveLength(
      before,
    );
    replies = [answer('I am available now.')];
    expect(
      (
        await owner.request('/ai/conversations/' + conversationId + '/messages', {
          message: 'Try later.',
        })
      ).status,
    ).toBe(201);
  });
  it('summarizes the full purchase history for a supplier without guessing from the first 20 orders', async () => {
    const person = (
      await db.pool.query('SELECT id FROM employees WHERE store_id=$1 LIMIT 1', [storeId])
    ).rows[0];
    const device = (
      await db.pool.query('SELECT id FROM devices WHERE store_id=$1 LIMIT 1', [storeId])
    ).rows[0];
    const supplier = (
      await db.pool.query(
        "INSERT INTO suppliers(store_id,code,name) VALUES($1,'FOOD-1','Food supplier') RETURNING id",
        [storeId],
      )
    ).rows[0];
    const purchase = (
      await db.pool.query(
        "INSERT INTO purchases(store_id,supplier_id,number,status,subtotal,tax,total,created_by,device_id) VALUES($1,$2,'PO-AI-1','received',100,0,100,$3,$4) RETURNING id",
        [storeId, supplier.id, person.id, device.id],
      )
    ).rows[0];
    await db.pool.query(
      "INSERT INTO goods_receipts(store_id,purchase_id,number,employee_id,device_id,subtotal,tax,total) VALUES($1,$2,'GR-AI-1',$3,$4,50,0,50)",
      [storeId, purchase.id, person.id, device.id],
    );
    replies = [
      call('supplier_purchase_summary', { supplierId: supplier.id, from: null, to: null }),
      answer('Food supplier has 100 NOK ordered and 50 NOK received.'),
    ];
    const result = await owner.request('/ai/conversations/' + conversationId + '/messages', {
      message: 'How much did I purchase from Food supplier?',
    });
    expect(result.status).toBe(201);
    expect(providerCalls.at(-1).input.at(-1).output).toContain('"received_delivery_total":"50.00"');
    expect(providerCalls.at(-1).input.at(-1).output).toContain('"unpaid_order_total":"100.00"');
  });
  it('reports empty results without inventing products', async () => {
    replies = [
      call('search_products', { query: 'unlisted product' }),
      answer('I could not find that product in your catalog.'),
    ];
    const result = await owner.request('/ai/conversations/' + conversationId + '/messages', {
      message: 'Find unlisted product.',
    });
    expect(result.status).toBe(201);
    expect(providerCalls.at(-1).input.at(-1).output).toBe('[]');
  });
  it('isolates conversations and scans across employees and stores', async () => {
    const second = await db.pool.query(
      "INSERT INTO organizations(name) VALUES('Other') RETURNING id",
    );
    const store = (
      await db.pool.query(
        "INSERT INTO stores(organization_id,name,currency,timezone) VALUES($1,'Other shop','NOK','Europe/Oslo') RETURNING id",
        [second.rows[0].id],
      )
    ).rows[0];
    const role = (
      await db.pool.query(
        "INSERT INTO roles(store_id,name,permissions) VALUES($1,'Owner',$2) RETURNING id",
        [store.id, JSON.stringify(['catalog.read', 'purchases.read', 'sales.read'])],
      )
    ).rows[0];
    const employee = (
      await db.pool.query(
        "INSERT INTO employees(store_id,role_id,name,email,password_hash) VALUES($1,$2,'Other','other@example.test',$3) RETURNING id",
        [store.id, role.id, await passwordHash('password-for-other')],
      )
    ).rows[0];
    const device = (
      await db.pool.query(
        "INSERT INTO devices(store_id,name,token_hash) VALUES($1,'Other device',$2) RETURNING id",
        [store.id, hash('other-device')],
      )
    ).rows[0];
    const token = 'other-session';
    await db.pool.query(
      "INSERT INTO sessions(token_hash,employee_id,device_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [hash(token), employee.id, device.id],
    );
    outsider.cookies.set('eliza_session', token);
    expect((await outsider.request('/ai/conversations/' + conversationId)).status).toBe(404);
    expect(
      (
        await outsider.request('/ai/conversations/' + conversationId + '/messages', {
          message: 'Read this store',
        })
      ).status,
    ).toBe(404);
    const otherToken = 'same-store-session';
    const otherRole = (
      await db.pool.query("SELECT id FROM roles WHERE store_id=$1 AND name='Cashier'", [storeId])
    ).rows[0];
    const otherEmployee = (
      await db.pool.query(
        "INSERT INTO employees(store_id,role_id,name,email,password_hash) VALUES($1,$2,'Cashier','cashier-ai@example.test',$3) RETURNING id",
        [storeId, otherRole.id, await passwordHash('cashier-password')],
      )
    ).rows[0];
    const mainDevice = (
      await db.pool.query('SELECT id FROM devices WHERE store_id=$1 LIMIT 1', [storeId])
    ).rows[0];
    await db.pool.query(
      "INSERT INTO sessions(token_hash,employee_id,device_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [hash(otherToken), otherEmployee.id, mainDevice.id],
    );
    sameStoreOther.cookies.set('eliza_session', otherToken);
    expect((await sameStoreOther.request('/ai/conversations/' + conversationId)).status).toBe(404);
    const own = (await sameStoreOther.request('/ai/conversations', {})).body.id;
    expect(
      (
        await sameStoreOther.request('/ai/conversations/' + own + '/messages', {
          message: 'Read the attached invoice.',
          documentId: scannedId,
        })
      ).status,
    ).toBe(403);
    replies = [
      call('document_details', { id: scannedId }),
      answer('I cannot access that document.'),
    ];
    const external = (await outsider.request('/ai/conversations', {})).body.id;
    const denied = await outsider.request('/ai/conversations/' + external + '/messages', {
      message: 'Read invoice.',
      documentId: scannedId,
    });
    expect(denied.status).toBe(404);
  });
  it('offers no write tools and rejects fabricated write calls', async () => {
    replies = [
      call('update_inventory', { productId: scannedId, quantity: 999 }),
      answer('I cannot update inventory from chat.'),
    ];
    const result = await owner.request('/ai/conversations/' + conversationId + '/messages', {
      message: 'Update stock for me.',
    });
    expect(result.status).toBe(201);
    expect(providerCalls.at(-2).tools.every((tool: any) => !tool.name.startsWith('update_'))).toBe(
      true,
    );
    expect(providerCalls.at(-1).input.at(-1).output).toContain('Unknown tool');
  });
  it('does not invent gross profit when a sale lacks a cost record', async () => {
    replies = [
      call('gross_profit', { from: '2026-09-01', to: '2026-09-30' }),
      answer('Gross profit is unavailable because a cost record is missing.'),
    ];
    const result = await owner.request('/ai/conversations/' + conversationId + '/messages', {
      message: 'What was gross profit this month?',
    });
    expect(result.status).toBe(201);
    const output = JSON.parse(providerCalls.at(-1).input.at(-1).output);
    expect(output.grossProfit).toBeNull();
    expect(Number(output.missingCostRecords)).toBeGreaterThan(0);
  });
  it('compresses long persisted history while keeping recent turns', async () => {
    for (let i = 0; i < 24; i++)
      await db.pool.query(
        'INSERT INTO ai_messages(store_id,conversation_id,role,content) VALUES($1,$2,$3,$4)',
        [storeId, conversationId, i % 2 ? 'assistant' : 'user', 'Earlier turn ' + i],
      );
    replies = [
      answer('Earlier discussion concerned September sales and invoice 9605.'),
      answer('I can continue from that context.'),
    ];
    const result = await owner.request('/ai/conversations/' + conversationId + '/messages', {
      message: 'Continue.',
    });
    expect(result.status).toBe(201);
    expect(
      providerCalls
        .at(-1)
        .input.some((item: any) => String(item.content).includes('Earlier conversation summary')),
    ).toBe(true);
    expect(providerCalls.at(-1).input.some((item: any) => item.content === 'Earlier turn 23')).toBe(
      true,
    );
    const stored = (
      await db.pool.query('SELECT summary,summary_through_seq FROM ai_conversations WHERE id=$1', [
        conversationId,
      ])
    ).rows[0];
    expect(stored.summary).toContain('September sales');
    expect(Number(stored.summary_through_seq)).toBeGreaterThan(0);
  });
});
