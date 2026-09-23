import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { documentDataSchema, productSchema, productSku, purchaseDraftSchema, supplierSchema, type Permission } from '@eliza/contracts';
import type { Database } from './database.js';
import type { AuthRequest } from './security.js';
import { CatalogController } from './catalog.js';
import { PurchasingController } from './purchasing.js';
import { Operations } from './operations.js';

export const proposalToolSchema = z.object({
  kind: z.enum(['supplier', 'product', 'purchase']),
  operation: z.enum(['create', 'update']),
  summary: z.string().trim().min(5).max(300),
  data: z.string().min(2).max(30000),
}).strict();
export type Proposal = {
  id: string;
  kind: 'supplier' | 'product' | 'purchase';
  operation: 'create' | 'update';
  summary: string;
  payload: Record<string, unknown>;
};
const permissionFor = { supplier: 'suppliers.manage', product: 'catalog.write', purchase: 'purchases.write' } as const;
export function canPropose(permissions: readonly Permission[]) {
  return Object.values(permissionFor).some((permission) => permissions.includes(permission));
}
function validate(kind: Proposal['kind'], operation: Proposal['operation'], raw: unknown) {
  const identity = z.object({ id: z.uuid(), version: z.number().int().positive() });
  if (kind === 'supplier') return supplierSchema.extend({
    ...(operation === 'update' ? identity.shape : {}),
    active: z.boolean().default(true),
  }).strict().parse(raw);
  if (kind === 'product') return productSchema.omit({ source: true }).extend({
    ...(operation === 'update' ? { id: z.uuid() } : {}),
    autoPlu: z.boolean().default(false),
    autoSku: z.boolean().default(false),
  }).strict().parse(raw);
  return purchaseDraftSchema.extend(operation === 'update' ? identity.shape : {}).strict().parse(raw);
}
export function stageProposal(raw: unknown, permissions: readonly Permission[]): Proposal | { error: string } {
  const parsed = proposalToolSchema.safeParse(raw);
  if (!parsed.success) return { error: 'Invalid proposal arguments.' };
  const { kind, operation, summary, data } = parsed.data;
  if (!permissions.includes(permissionFor[kind])) return { error: 'Permission denied for this change.' };
  try {
    const payload = validate(kind, operation, JSON.parse(data));
    return { id: randomUUID(), kind, operation, summary, payload };
  } catch (cause) {
    const detail = cause instanceof z.ZodError
      ? cause.issues.slice(0, 5).map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
      : 'Malformed JSON.';
    return { error: 'Invalid proposal: ' + detail };
  }
}
export async function stageDocumentProductProposal(
  database: Database,
  req: AuthRequest,
  raw: unknown,
): Promise<Proposal | { error: string }> {
  if (!req.context.user.permissions.includes('catalog.write') || !req.context.user.permissions.includes('purchases.read'))
    return { error: 'Permission denied.' };
  const args = z.object({ documentId: z.uuid(), tableIndex: z.number().int().min(0).max(29), rowIndex: z.number().int().min(0).max(499) }).strict().safeParse(raw);
  if (!args.success) return { error: 'Choose a valid saved document row.' };
  const result = await database.pool.query(
    "SELECT edited,status FROM scanned_documents WHERE id=$1 AND store_id=$2",
    [args.data.documentId, req.context.store.id],
  );
  if (!result.rowCount || result.rows[0].status !== 'saved')
    return { error: 'Save and review the digital document before proposing products.' };
  const document = documentDataSchema.safeParse(result.rows[0].edited);
  if (!document.success) return { error: 'The saved document needs correction before use.' };
  const table = document.data.tables[args.data.tableIndex];
  const row = table?.rows[args.data.rowIndex];
  if (!row?.product) return { error: 'Fill the product details in this row and save the document.' };
  const product = row.product;
  const productColumn = table.columns.findIndex((column) => /^(product|item|товар|наименование)$/i.test(column.key) || /^(product|item|товар|наименование)$/i.test(column.label.trim()));
  const name = product.name.trim() || (productColumn >= 0 ? (row.cells[productColumn] || '').trim() : '');
  const missing = [
    !name && 'name', !product.category && 'category', !product.unit && 'unit',
    !product.price && 'selling price', !product.cost && 'unit cost',
    !product.taxRate && 'tax rate', !product.minStock && 'minimum stock',
  ].filter(Boolean);
  if (missing.length) return { error: 'Complete and save these product fields: ' + missing.join(', ') + '.' };
  const sku = product.sku || productSku(name, product.plu);
  const parsed = productSchema.omit({ source: true }).extend({ autoSku: z.boolean(), autoPlu: z.boolean() }).safeParse({
    name, sku, plu: product.plu, autoSku: !product.sku, autoPlu: !product.plu,
    category: product.category, unit: product.unit, price: product.price.replace(',', '.'),
    cost: product.cost.replace(',', '.'), taxRate: product.taxRate.replace(',', '.'),
    minStock: product.minStock.replace(',', '.'), description: product.description,
    image: product.image, barcodes: product.barcode ? [product.barcode] : [],
  });
  if (!parsed.success) return { error: 'Correct the product fields before proposing creation: ' + parsed.error.issues.slice(0, 3).map((issue) => issue.path.join('.') + ': ' + issue.message).join('; ') };
  const duplicate = await database.pool.query(
    `SELECT DISTINCT p.id,p.name FROM products p LEFT JOIN barcodes b ON b.product_id=p.id AND b.store_id=p.store_id
     WHERE p.store_id=$1 AND (lower(p.name)=lower($2) OR ($3<>'' AND p.sku=$3) OR ($4<>'' AND b.value=$4)) LIMIT 3`,
    [req.context.store.id, name, product.sku, product.barcode],
  );
  if (duplicate.rowCount) return { error: 'Possible existing product: ' + duplicate.rows.map((item) => item.name + ' (' + item.id + ')').join(', ') + '. Review it before creating another.' };
  return { id: randomUUID(), kind: 'product', operation: 'create', summary: 'Create product ' + name, payload: parsed.data };
}
export async function applyProposal(database: Database, req: AuthRequest, proposal: Proposal) {
  if (!req.context.user.permissions.includes(permissionFor[proposal.kind]))
    throw new ForbiddenException('Permission denied for this change.');
  const data = validate(proposal.kind, proposal.operation, proposal.payload);
  if (proposal.kind === 'supplier') {
    const body = data as z.infer<typeof supplierSchema> & { id?: string; version?: number; active: boolean };
    return new PurchasingController(database, new Operations(database)).supplier({
      ...body, requestId: proposal.id,
    }, req);
  }
  if (proposal.kind === 'product') {
    const body = data as z.infer<typeof productSchema> & { id?: string; autoPlu?: boolean; autoSku?: boolean };
    const controller = new CatalogController(database);
    if (proposal.operation === 'update') {
      const { id, autoPlu: _autoPlu, autoSku: _autoSku, ...values } = body;
      if (!id) throw new BadRequestException('Choose a product to update.');
      return controller.edit(id, values, req);
    }
    const { id: _id, ...values } = body;
    return controller.create(values, req);
  }
  const body = data as z.infer<typeof purchaseDraftSchema> & { id?: string; version?: number };
  if (proposal.operation === 'create' && body.supplierReference) {
    const duplicate = await database.pool.query(
      'SELECT number FROM purchases WHERE store_id=$1 AND supplier_id=$2 AND supplier_reference=$3 AND status<>$4 LIMIT 1',
      [req.context.store.id, body.supplierId, body.supplierReference, 'cancelled'],
    );
    if (duplicate.rowCount) throw new ConflictException('This supplier reference is already used by purchase ' + duplicate.rows[0].number + '.');
  }
  return new PurchasingController(database, new Operations(database)).draft({
    ...body, requestId: proposal.id,
  }, req);
}
export async function decideProposal(database: Database, req: AuthRequest, id: string, approve: boolean) {
  const owner = [id, req.context.store.id, req.context.user.id];
  if (!approve) {
    const rejected = await database.pool.query(
      `UPDATE ai_action_proposals SET status='rejected',decided_at=now() WHERE id=$1 AND store_id=$2 AND employee_id=$3 AND status='pending' RETURNING id,status,kind,operation,summary`, owner,
    );
    if (rejected.rows[0]) return rejected.rows[0];
    throw new ConflictException('This proposal is no longer pending.');
  }
  const claimed = await database.pool.query(
    `UPDATE ai_action_proposals SET status='processing' WHERE id=$1 AND store_id=$2 AND employee_id=$3 AND status='pending' AND expires_at>now() RETURNING id,kind,operation,summary,payload`, owner,
  );
  const row = claimed.rows[0];
  if (!row) {
    const exists = await database.pool.query('SELECT status FROM ai_action_proposals WHERE id=$1 AND store_id=$2 AND employee_id=$3', owner);
    if (!exists.rows[0]) throw new NotFoundException('Proposal not found.');
    throw new ConflictException('This proposal is no longer pending or has expired.');
  }
  try {
    const applied = await applyProposal(database, req, row as Proposal) as { id?: string; number?: string; name?: string };
    const result = { id: applied.id, ...(applied.number ? { number: applied.number } : {}), ...(applied.name ? { name: applied.name } : {}) };
    const saved = await database.pool.query(
      `UPDATE ai_action_proposals SET status='applied',result=$2,decided_at=now() WHERE id=$1 RETURNING id,status,kind,operation,summary,result`,
      [id, JSON.stringify(result)],
    );
    return saved.rows[0];
  } catch (cause) {
    await database.pool.query(`UPDATE ai_action_proposals SET status='pending' WHERE id=$1 AND status='processing'`, [id]);
    throw cause;
  }
}
