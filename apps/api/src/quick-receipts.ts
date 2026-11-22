import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  quickReceiptInputSchema,
  quickReceiptShortcutSchema,
  productDisplayName,
  calculatePurchaseLine,
  toScaled,
  type Permission,
} from '@eliza/contracts';
import { AuthModule } from './auth.js';
import { AccessGuard, cookie, hash, parse, type AuthRequest } from './security.js';
import { Operations, audit, type Actor } from './operations.js';
import { RegisterModule, RegisterService } from './register.js';
import { receivePurchase, wholeQuantity } from './purchase-receiving.js';

type Receiver = Actor & { permissions: Permission[] };
const saveSchema = quickReceiptShortcutSchema
  .extend({
    requestId: z.uuid(),
    id: z.uuid().optional(),
    version: z.number().int().positive().optional(),
  })
  .strict();
const shortcutColumns = `q.id,q.name,q.supplier_id AS "supplierId",q.product_id AS "productId",q.tax_rate AS "taxRate",q.active,q.version,s.name AS "supplierName",p.name AS "productName",p.volume,p.sku,p.unit,p.image,(q.active AND s.active AND p.active AND p.base_product_id IS NULL) AS available`;
const joins = `FROM quick_receipt_shortcuts q JOIN suppliers s ON s.id=q.supplier_id AND s.store_id=q.store_id JOIN products p ON p.id=q.product_id AND p.store_id=q.store_id`;
@Injectable()
export class QuickReceipts {
  constructor(
    private operations: Operations,
    private register: RegisterService,
  ) {}
  private async actor(c: PoolClient, req: Request, pos: boolean): Promise<Receiver> {
    if (pos) return this.register.operator(c, req);
    const row = (
      await c.query(
        `SELECT e.id AS "employeeId",e.store_id AS "storeId",d.id AS "deviceId",r.id AS "roleId"
      FROM sessions s JOIN employees e ON e.id=s.employee_id JOIN devices d ON d.id=s.device_id JOIN roles r ON r.id=e.role_id AND r.store_id=e.store_id
      WHERE s.token_hash=$1 AND s.expires_at>now() AND e.active AND d.active AND d.type='management' AND d.store_id=e.store_id FOR SHARE OF s,e,d,r`,
        [hash(cookie(req, 'eliza_session'))],
      )
    ).rows[0];
    if (!row) throw new ForbiddenException('Your access changed. Sign in again.');
    const roles = await c.query(
      `SELECT r.permissions FROM roles r WHERE r.store_id=$1 AND (r.id=$3 OR EXISTS(SELECT 1 FROM employee_roles er WHERE er.role_id=r.id AND er.store_id=r.store_id AND er.employee_id=$2)) FOR SHARE OF r`,
      [row.storeId, row.employeeId, row.roleId],
    );
    return {
      ...row,
      permissions: [...new Set(roles.rows.flatMap((r) => r.permissions))] as Permission[],
    };
  }
  private configure(a: Receiver) {
    return a.permissions.includes('purchases.write') && a.permissions.includes('purchases.cost');
  }
  private receive(a: Receiver) {
    if (!a.permissions.includes('purchases.quick_receive'))
      throw new ForbiddenException('You cannot use quick receiving.');
  }
  async list(req: Request, pos = false) {
    return this.operations.transaction(async (c) => {
      const a = await this.actor(c, req, pos);
      const configure = !pos && this.configure(a);
      if (!configure) this.receive(a);
      const rows = await c.query(
        `SELECT ${shortcutColumns} ${joins} WHERE q.store_id=$1 ${configure ? '' : 'AND q.active'} ORDER BY q.active DESC,lower(q.name),q.id`,
        [a.storeId],
      );
      return rows.rows.map((p) => ({
        ...p,
        productName: productDisplayName({ name: p.productName, volume: p.volume }),
      }));
    });
  }
  async options(req: Request) {
    return this.operations.transaction(async (c) => {
      const a = await this.actor(c, req, false);
      if (!this.configure(a)) throw new ForbiddenException('You cannot configure quick receiving.');
      const suppliers = (
        await c.query(
          'SELECT id,name FROM suppliers WHERE store_id=$1 AND active ORDER BY lower(name)',
          [a.storeId],
        )
      ).rows;
      const products = (
        await c.query(
          `SELECT p.id,p.name,p.volume,p.sku,p.unit,COALESCE((SELECT jsonb_agg(b.value) FROM barcodes b WHERE b.product_id=p.id AND b.store_id=p.store_id),'[]'::jsonb) AS barcodes FROM products p WHERE p.store_id=$1 AND p.active AND p.base_product_id IS NULL ORDER BY lower(p.name),p.id`,
          [a.storeId],
        )
      ).rows.map((p) => ({ ...p, name: productDisplayName(p) }));
      return { suppliers, products };
    });
  }
  private async command(
    c: PoolClient,
    a: Receiver,
    action: string,
    b: { requestId: string; [key: string]: unknown },
    work: () => Promise<unknown>,
  ) {
    const signature = hash(
      JSON.stringify({ action, body: b, employee: a.employeeId, device: a.deviceId }),
    );
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      a.storeId + b.requestId,
    ]);
    const old = (
      await c.query(
        'SELECT request_hash,result FROM purchasing_commands WHERE store_id=$1 AND request_id=$2',
        [a.storeId, b.requestId],
      )
    ).rows[0];
    if (old) {
      if (old.request_hash !== signature)
        throw new ConflictException('This request was already used for another change.');
      return old.result;
    }
    const result = await work();
    await c.query(
      'INSERT INTO purchasing_commands(store_id,request_id,action,request_hash,result,employee_id,device_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [a.storeId, b.requestId, action, signature, JSON.stringify(result), a.employeeId, a.deviceId],
    );
    return result;
  }
  async save(req: Request, input: unknown) {
    const b = parse(saveSchema, input);
    if (b.id && !b.version) throw new BadRequestException('Refresh the shortcut before saving.');
    return this.operations.transaction(async (c) => {
      const a = await this.actor(c, req, false);
      if (!this.configure(a)) throw new ForbiddenException('You cannot configure quick receiving.');
      return this.command(c, a, 'quick-receipt-shortcut', b, async () => {
        if (b.id) {
          const old = (
            await c.query(
              'SELECT * FROM quick_receipt_shortcuts WHERE id=$1 AND store_id=$2 FOR UPDATE',
              [b.id, a.storeId],
            )
          ).rows[0];
          if (!old) throw new NotFoundException('Shortcut not found.');
          if (old.version !== b.version)
            throw new ConflictException('Shortcut changed. Refresh before continuing.');
        }
        const supplier = (
          await c.query('SELECT id,active FROM suppliers WHERE id=$1 AND store_id=$2 FOR SHARE', [
            b.supplierId,
            a.storeId,
          ])
        ).rows[0];
        const product = (
          await c.query(
            'SELECT id,active,base_product_id FROM products WHERE id=$1 AND store_id=$2 FOR SHARE',
            [b.productId, a.storeId],
          )
        ).rows[0];
        // Archiving must remain possible when the supplier/product was deactivated.
        if (
          !supplier ||
          !product ||
          product.base_product_id ||
          (b.active && (!supplier.active || !product.active))
        )
          throw new BadRequestException('Choose an active product and supplier from this store.');
        const q = b.id
          ? await c.query(
              'UPDATE quick_receipt_shortcuts SET name=$3,supplier_id=$4,product_id=$5,tax_rate=$6,active=$7,updated_by=$8,version=version+1,updated_at=now() WHERE id=$1 AND store_id=$2 RETURNING id',
              [
                b.id,
                a.storeId,
                b.name,
                b.supplierId,
                b.productId,
                b.taxRate,
                b.active,
                a.employeeId,
              ],
            )
          : await c.query(
              'INSERT INTO quick_receipt_shortcuts(store_id,name,supplier_id,product_id,tax_rate,active,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id',
              [a.storeId, b.name, b.supplierId, b.productId, b.taxRate, b.active, a.employeeId],
            );
        await audit(
          c,
          a,
          b.id ? 'Quick receiving shortcut updated' : 'Quick receiving shortcut created',
          q.rows[0].id,
          {
            name: b.name,
            supplierId: b.supplierId,
            productId: b.productId,
            taxRate: b.taxRate,
            active: b.active,
          },
        );
        return q.rows[0];
      });
    });
  }
  async record(req: Request, id: string, input: unknown, pos = false) {
    const b = parse(quickReceiptInputSchema, input);
    return this.operations.transaction(async (c) => {
      const a = await this.actor(c, req, pos);
      this.receive(a);
      return this.command(c, a, 'quick-receive', { ...b, shortcutId: id }, async () => {
        const q = (
          await c.query(
            'SELECT * FROM quick_receipt_shortcuts WHERE id=$1 AND store_id=$2 FOR SHARE',
            [id, a.storeId],
          )
        ).rows[0];
        if (!q) throw new NotFoundException('Shortcut not found.');
        if (!q.active || q.version !== b.version)
          throw new ConflictException('Shortcut changed. Refresh before continuing.');
        const supplier = (
          await c.query(
            'SELECT id FROM suppliers WHERE id=$1 AND store_id=$2 AND active FOR SHARE',
            [q.supplier_id, a.storeId],
          )
        ).rowCount;
        const p = (
          await c.query(
            'SELECT * FROM products WHERE id=$1 AND store_id=$2 AND active AND base_product_id IS NULL FOR UPDATE',
            [q.product_id, a.storeId],
          )
        ).rows[0];
        if (!supplier || !p)
          throw new BadRequestException('Activate the product and supplier before receiving.');
        wholeQuantity(p.unit, b.quantity);
        const totals = calculatePurchaseLine(b.unitCost, b.quantity, q.tax_rate);
        if (toScaled(totals.total, 2) > 99999999999n)
          throw new BadRequestException('Delivery total is too large.');
        const purchase = (
          await c.query(
            `INSERT INTO purchases(store_id,supplier_id,number,status,ordered_at,supplier_reference,notes,subtotal,tax,total,created_by,device_id,quick_receipt_shortcut_id) VALUES($1,$2,'PO-'||lpad(nextval('purchase_number_sequence')::text,6,'0'),'ordered',now(),$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,version`,
            [
              a.storeId,
              q.supplier_id,
              b.deliveryReference,
              b.notes,
              totals.subtotal,
              totals.tax,
              totals.total,
              a.employeeId,
              a.deviceId,
              id,
            ],
          )
        ).rows[0];
        const line = (
          await c.query(
            'INSERT INTO purchase_lines(store_id,purchase_id,product_id,product_name,sku,unit,ordered_quantity,unit_cost,tax_rate,subtotal,tax,total) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',
            [
              a.storeId,
              purchase.id,
              p.id,
              productDisplayName(p),
              p.sku,
              p.unit,
              b.quantity,
              b.unitCost,
              q.tax_rate,
              totals.subtotal,
              totals.tax,
              totals.total,
            ],
          )
        ).rows[0];
        await c.query(
          `INSERT INTO supplier_products(store_id,supplier_id,product_id,pack_size,pack_cost) VALUES($1,$2,$3,1,NULL) ON CONFLICT(supplier_id,product_id) DO UPDATE SET active=true,version=supplier_products.version+1,updated_at=now() WHERE NOT supplier_products.active`,
          [a.storeId, q.supplier_id, p.id],
        );
        const result = await receivePurchase(c, a, purchase.id, {
          requestId: b.requestId,
          version: purchase.version,
          deliveryReference: b.deliveryReference,
          notes: b.notes,
          lines: [
            { purchaseLineId: line.id, quantity: b.quantity, expiryDate: b.expiryDate || null },
          ],
        });
        await audit(c, a, 'Quick delivery received', purchase.id, {
          shortcutId: id,
          shortcutName: q.name,
          supplierId: q.supplier_id,
          productId: p.id,
          quantity: b.quantity,
          unitCost: b.unitCost,
          taxRate: q.tax_rate,
          total: totals.total,
        });
        return { ...result, quantity: b.quantity, total: totals.total };
      });
    });
  }
}
@Controller('quick-receipts')
@UseGuards(AccessGuard)
class QuickReceiptsController {
  constructor(private receipts: QuickReceipts) {}
  @Get() list(@Req() req: AuthRequest) {
    return this.receipts.list(req);
  }
  @Get('options') options(@Req() req: AuthRequest) {
    return this.receipts.options(req);
  }
  @Post() save(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.receipts.save(req, body);
  }
  @Post(':id/receive') record(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.receipts.record(req, id, body);
  }
}
@Controller('pos/quick-receipts')
class PosQuickReceiptsController {
  constructor(private receipts: QuickReceipts) {}
  @Get() list(@Req() req: Request) {
    return this.receipts.list(req, true);
  }
  @Post(':id/receive') record(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.receipts.record(req, id, body, true);
  }
}
@Module({
  imports: [AuthModule, RegisterModule],
  controllers: [QuickReceiptsController, PosQuickReceiptsController],
  providers: [QuickReceipts, Operations],
})
export class QuickReceiptsModule {}
