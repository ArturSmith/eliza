import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { productSchema, purchaseDraftSchema, supplierSchema, type Permission } from '@eliza/contracts';
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
  if (kind === 'product') return productSchema.omit({ image: true, source: true }).extend({
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
