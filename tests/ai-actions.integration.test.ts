import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database.js';
import { stageDocumentProductProposal, stageProposal } from '../apps/api/src/ai-actions';
import { executeAiTool } from '../apps/api/src/ai-tools';

const originalUrl = process.env.DATABASE_URL;
const admin = new Database();
const name = `eliza_ai_actions_test_${Date.now()}`;
let db: Database, app: Awaited<ReturnType<typeof createApp>>, url: string;
let cookies = '', storeId = '', employeeId = '', conversationId = '', messageId = '';
async function request(path: string, body?: unknown) {
  const response = await fetch(url + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: 'http://localhost:5173', 'X-Eliza-Request': '1', 'Content-Type': 'application/json', Cookie: cookies },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.headers.getSetCookie().length) cookies = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  return { status: response.status, body: await response.json() };
}
async function proposal(kind: 'supplier' | 'product' | 'purchase', data: unknown, operation: 'create' | 'update' = 'create') {
  const staged = stageProposal({ kind, operation, summary: 'Create reviewed ' + kind, data: JSON.stringify(data) }, ['suppliers.manage', 'catalog.write', 'purchases.write']);
  if (!('payload' in staged)) throw new Error(staged.error);
  await db.pool.query(
    'INSERT INTO ai_action_proposals(id,store_id,employee_id,conversation_id,message_id,kind,operation,summary,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [staged.id, storeId, employeeId, conversationId, messageId, kind, staged.operation, staged.summary, JSON.stringify(staged.payload)],
  );
  return staged.id;
}
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
  expect((await request('/auth/setup', { storeName: 'AI write shop', ownerName: 'Owner', email: 'ai-write@test.example', password: 'test-password-12345', currency: 'NOK', timezone: 'Europe/Oslo' })).status).toBe(201);
  const actor = (await db.pool.query('SELECT id,store_id FROM employees LIMIT 1')).rows[0];
  employeeId = actor.id; storeId = actor.store_id;
  conversationId = (await request('/ai/conversations', {})).body.id;
  messageId = (await db.pool.query("INSERT INTO ai_messages(store_id,conversation_id,role,content) VALUES($1,$2,'assistant','Review this change') RETURNING id", [storeId, conversationId])).rows[0].id;
});
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.onModuleDestroy();
  if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
  await admin.pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
});
describe('approved AI writes', () => {
  it('requires approval, creates supplier, product and purchase through normal validated writes, and cannot apply twice', async () => {
    const supplierAction = await proposal('supplier', { code: 'AI-SUP', name: 'ИП Магомадов Р.А.', phone: '+7 969 722-22-22', contactName: 'М-7 С. Мохамад', contactPhone: '89292088095' });
    expect((await db.pool.query('SELECT count(*)::int AS count FROM suppliers')).rows[0].count).toBe(0);
    const supplier = await request('/ai/actions/' + supplierAction + '/approve', {});
    expect(supplier.status).toBe(201);
    expect(supplier.body).toMatchObject({ status: 'applied', kind: 'supplier' });
    expect((await request('/ai/actions/' + supplierAction + '/approve', {})).status).toBe(409);
    const supplierId = supplier.body.result.id;
    const productAction = await proposal('product', { name: 'Milk', sku: 'AI-MILK', category: 'Dairy', unit: 'piece', price: '12', cost: '8', minStock: '0', barcodes: [], plu: '' });
    const product = await request('/ai/actions/' + productAction + '/approve', {});
    expect(product.status).toBe(201);
    const productId = product.body.result.id;
    const purchaseAction = await proposal('purchase', { supplierId, supplierReference: 'U2-12670', buyerName: 'Chir-kort', driverName: 'Saliev', lines: [{ productId, quantity: '2', unitCost: '8', taxRate: '0' }] });
    const purchase = await request('/ai/actions/' + purchaseAction + '/approve', {});
    expect(purchase.status).toBe(201);
    expect(purchase.body).toMatchObject({ status: 'applied', kind: 'purchase' });
    const saved = await request('/purchases/' + purchase.body.result.id);
    expect(saved.body).toMatchObject({ supplier_id: supplierId, buyer_name: 'Chir-kort', driver_name: 'Saliev' });
    const currentSupplier = (await request('/suppliers')).body.find((row: { id: string }) => row.id === supplierId);
    const { createdAt: _createdAt, ...supplierFields } = currentSupplier;
    const supplierUpdateId = await proposal('supplier', { ...supplierFields, contactPhone: '89292088096' }, 'update');
    expect((await request('/ai/actions/' + supplierUpdateId + '/approve', {})).status).toBe(201);
    expect((await request('/suppliers')).body.find((row: { id: string }) => row.id === supplierId).contactPhone).toBe('89292088096');
    const productUpdateId = await proposal('product', { id: productId, name: 'Whole milk', sku: 'AI-MILK', category: 'Dairy', unit: 'piece', price: '13', cost: '8', minStock: '0', barcodes: [], plu: '', taxRate: '0' }, 'update');
    expect((await request('/ai/actions/' + productUpdateId + '/approve', {})).status).toBe(201);
    expect((await request('/products')).body.find((row: { id: string }) => row.id === productId).name).toBe('Whole milk');
    const purchaseUpdateId = await proposal('purchase', { id: purchase.body.result.id, version: saved.body.version, supplierId, supplierReference: 'U2-12670', buyerName: 'Updated buyer', lines: [{ productId, quantity: '3', unitCost: '8', taxRate: '0' }] }, 'update');
    expect((await request('/ai/actions/' + purchaseUpdateId + '/approve', {})).status).toBe(201);
    expect((await request('/purchases/' + purchase.body.result.id)).body.buyer_name).toBe('Updated buyer');
    const history = await request('/ai/conversations/' + conversationId);
    expect(history.body.messages[0].actions).toHaveLength(6);
  });
  it('turns an AI tool call into a pending chat proposal without saving it', async () => {
    const realFetch = globalThis.fetch;
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-only-key';
    let calls = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === 'https://api.openai.com/v1/responses') {
        calls++;
        const body = calls === 1
          ? { status: 'completed', output: [{ type: 'function_call', name: 'propose_change', call_id: 'call-1', arguments: JSON.stringify({ kind: 'supplier', operation: 'create', summary: 'Create supplier from reviewed details', data: JSON.stringify({ code: 'AI-FROM-CHAT', name: 'Chat supplier', phone: '+7 969 722-22-22' }) }) }] }
          : { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Please review and approve the supplier card.' }] }] };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return realFetch(input, init);
    });
    try {
      const conversation = (await request('/ai/conversations', {})).body.id;
      const answer = await request('/ai/conversations/' + conversation + '/messages', { message: 'Create Chat supplier with phone +7 969 722-22-22' });
      expect(answer.status).toBe(201);
      expect(answer.body.messages[1].actions).toHaveLength(1);
      expect(answer.body.messages[1].actions[0].status).toBe('pending');
      expect((await db.pool.query("SELECT count(*)::int AS count FROM suppliers WHERE code='AI-FROM-CHAT'")).rows[0].count).toBe(0);
      const actionId = answer.body.messages[1].actions[0].id;
      expect((await request('/ai/actions/' + actionId + '/approve', {})).status).toBe(201);
      expect((await db.pool.query("SELECT count(*)::int AS count FROM suppliers WHERE code='AI-FROM-CHAT'")).rows[0].count).toBe(1);
    } finally {
      vi.unstubAllGlobals();
      if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
    }
  });
  it('proposes a reviewed scanned product with its photo and creates it only after approval', async () => {
    const deviceId = (await db.pool.query('SELECT id FROM devices WHERE store_id=$1 LIMIT 1', [storeId])).rows[0].id;
    const image = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(80);
    const edited = {
      documentType: 'invoice', language: 'en', title: 'Supplier invoice', number: 'A-1', date: '', currency: 'NOK', summary: '', pages: 1,
      parties: [], fields: [], sections: [], additionalText: [], annotations: [], printedTotal: '', extractionWarnings: [],
      tables: [{ id: 'items', title: 'Items', columns: [{ key: 'product', label: 'Product', kind: 'text' }], footerRows: [], rows: [{ rowNumber: '1', cells: ['Test biscuits'], product: { name: 'Test biscuits', sku: '', barcode: '5449000000996', plu: '', image, description: 'Small pack', category: 'Snacks', unit: 'piece', price: '15', cost: '10', taxRate: '0', minStock: '0' } }] }],
    };
    const scanId = (await db.pool.query(
      `INSERT INTO scanned_documents(store_id,created_by,device_id,filename,mime_type,original_file,extracted,edited,validation,document_type,status)
       VALUES($1,$2,$3,'invoice.png','image/png',$4,$5,$5,'{}','invoice','saved') RETURNING id`,
      [storeId, employeeId, deviceId, Buffer.from('test'), JSON.stringify(edited)],
    )).rows[0].id;
    const actor = { context: { store: { id: storeId }, user: { id: employeeId, permissions: ['catalog.write', 'purchases.read'] } } } as any;
    const readable = await executeAiTool(db, actor, 'document_details', { id: scanId }) as any;
    expect(readable.edited.tables[0].rows[0].product).toMatchObject({ name: 'Test biscuits', barcode: '5449000000996', image: '[uploaded image available for product proposal]' });
    const draft = await stageDocumentProductProposal(db, actor, { documentId: scanId, tableIndex: 0, rowIndex: 0 });
    expect(draft).toMatchObject({ kind: 'product', operation: 'create', payload: { name: 'Test biscuits', image, barcodes: ['5449000000996'], autoSku: true, autoPlu: true } });
    expect((await db.pool.query("SELECT count(*)::int AS count FROM products WHERE name='Test biscuits'")).rows[0].count).toBe(0);
    if (!('payload' in draft)) throw new Error(draft.error);
    const conversation = (await request('/ai/conversations', {})).body.id;
    const message = (await db.pool.query("INSERT INTO ai_messages(store_id,conversation_id,role,content) VALUES($1,$2,'assistant','Review product') RETURNING id", [storeId, conversation])).rows[0].id;
    await db.pool.query('INSERT INTO ai_action_proposals(id,store_id,employee_id,conversation_id,message_id,kind,operation,summary,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [draft.id, storeId, employeeId, conversation, message, draft.kind, draft.operation, draft.summary, JSON.stringify(draft.payload)]);
    expect((await request('/ai/actions/' + draft.id + '/approve', {})).status).toBe(201);
    const created = (await db.pool.query("SELECT name,description,image FROM products WHERE name='Test biscuits'")).rows[0];
    expect(created).toMatchObject({ name: 'Test biscuits', description: 'Small pack', image });
    expect((await stageDocumentProductProposal(db, actor, { documentId: scanId, tableIndex: 0, rowIndex: 0 })).error).toContain('Possible existing product');
  });
  it('deletes scans without deleting chats and deletes chats without deleting saved records', async () => {
    const deviceId = (await db.pool.query('SELECT id FROM devices WHERE store_id=$1 LIMIT 1', [storeId])).rows[0].id;
    const scanId = (await db.pool.query(
      `INSERT INTO scanned_documents(store_id,created_by,device_id,filename,mime_type,original_file,extracted,edited,validation,document_type)
       VALUES($1,$2,$3,'invoice.png','image/png',$4,'{}','{}','{}','invoice') RETURNING id`,
      [storeId, employeeId, deviceId, Buffer.from('test')],
    )).rows[0].id;
    const conversation = (await request('/ai/conversations', {})).body.id;
    const attachedMessage = (await db.pool.query(
      "INSERT INTO ai_messages(store_id,conversation_id,role,content,document_id) VALUES($1,$2,'user','Please read this',$3) RETURNING id",
      [storeId, conversation, scanId],
    )).rows[0].id;
    const deleteRequest = async (path: string) => {
      const response = await fetch(url + '/api' + path, { method: 'DELETE', headers: { Origin: 'http://localhost:5173', 'X-Eliza-Request': '1', Cookie: cookies } });
      return { status: response.status, body: await response.json() };
    };
    expect((await deleteRequest('/documents/' + scanId)).body.deleted).toBe(true);
    expect((await request('/documents/' + scanId)).status).toBe(404);
    expect((await db.pool.query('SELECT document_id FROM ai_messages WHERE id=$1', [attachedMessage])).rows[0].document_id).toBeNull();
    expect((await request('/ai/conversations/' + conversation)).status).toBe(200);
    expect((await deleteRequest('/ai/conversations/' + conversation)).body.deleted).toBe(true);
    expect((await request('/ai/conversations/' + conversation)).status).toBe(404);
    expect((await db.pool.query('SELECT 1 FROM ai_messages WHERE conversation_id=$1', [conversation])).rowCount).toBe(0);
    expect((await db.pool.query('SELECT count(*)::int AS count FROM purchases')).rows[0].count).toBeGreaterThan(0);
  });
  it('rejects a proposal without writing a record', async () => {
    const id = await proposal('supplier', { code: 'AI-DECLINED', name: 'Declined supplier' });
    const rejected = await request('/ai/actions/' + id + '/reject', {});
    expect(rejected.body.status).toBe('rejected');
    expect((await db.pool.query("SELECT count(*)::int AS count FROM suppliers WHERE code='AI-DECLINED'")).rows[0].count).toBe(0);
  });
});
