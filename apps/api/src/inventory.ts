import { z } from 'zod';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { adjustmentSchema, fromScaled, toScaled } from '@eliza/contracts';
import { Database } from './database.js';
import { AccessGuard, type AuthRequest, hash, parse, Require } from './security.js';
import { AuthModule } from './auth.js';
import { audits, deviceRecords, employees, movements, products } from './schema.js';
const historyQuery = z
  .object({
    search: z.string().trim().max(100).default(''),
    productId: z.union([z.uuid(), z.literal('')]).default(''),
    from: z.union([z.iso.date(), z.literal('')]).default(''),
    to: z.union([z.iso.date(), z.literal('')]).default(''),
    page: z.coerce.number().int().min(1).max(1000000).default(1),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'Start date must not follow end date');
@Controller('inventory')
@UseGuards(AccessGuard)
export class InventoryController {
  constructor(private database: Database) {}
  @Get('products/:id/batches') @Require('inventory.read') async batches(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    const product = await this.database.pool.query(
      'SELECT id,name,stock FROM products WHERE id=$1 AND store_id=$2',
      [id, req.context.store.id],
    );
    if (!product.rows[0]) throw new NotFoundException('Product not found.');
    const batches = await this.database.pool.query(
      `SELECT b.id,b.receipt_line_id AS "receiptLineId",b.expiry_date::text AS "expiryDate",
       b.quantity::text,b.created_at AS "createdAt",
       CASE WHEN $3::boolean THEN b.unit_cost::text END AS "unitCost",
       CASE WHEN $3::boolean THEN b.cost_source END AS "costSource",
       CASE WHEN b.expiry_date IS NOT NULL AND b.expiry_date<=(now() AT TIME ZONE s.timezone)::date
       THEN true ELSE false END AS expired
       FROM stock_batches b JOIN stores s ON s.id=b.store_id
       WHERE b.store_id=$1 AND b.product_id=$2 AND b.quantity>0
       ORDER BY b.expiry_date ASC NULLS LAST,b.created_at,b.id`,
      [req.context.store.id, id, req.context.user.permissions.includes('costs.read')],
    );
    return { product: product.rows[0], batches: batches.rows };
  }
  @Get('movements') @Require('inventory.read') async list(@Req() req: AuthRequest) {
    return this.database.db
      .select({
        id: movements.id,
        productId: products.id,
        productName: products.name,
        sku: products.sku,
        quantity: movements.quantity,
        balance: movements.balance,
        reason: movements.reason,
        notes: movements.notes,
        actor: employees.name,
        device: deviceRecords.name,
        createdAt: movements.createdAt,
      })
      .from(movements)
      .innerJoin(products, eq(movements.productId, products.id))
      .innerJoin(employees, eq(movements.employeeId, employees.id))
      .innerJoin(deviceRecords, eq(movements.deviceId, deviceRecords.id))
      .where(eq(movements.storeId, req.context.store.id))
      .orderBy(desc(movements.createdAt))
      .limit(100);
  }
  @Get('movements/history') @Require('inventory.read') async history(
    @Query() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const filter = parse(historyQuery, input);
    const pattern = '%' + filter.search.replace(/[\\%_]/g, '\\$&') + '%';
    const pageSize = 50;
    const result = await this.database.pool.query(
      `WITH matched AS (
      SELECT m.id,m.product_id AS "productId",p.name AS "productName",p.sku,
        m.quantity::text,m.balance::text,m.reason,m.notes,e.name AS actor,d.name AS device,
        m.created_at AS "createdAt"
      FROM movements m JOIN products p ON p.id=m.product_id AND p.store_id=m.store_id
      LEFT JOIN employees e ON e.id=m.employee_id AND e.store_id=m.store_id
      LEFT JOIN device_records d ON d.id=m.device_id AND d.store_id=m.store_id
      WHERE m.store_id=$1 AND ($2='' OR m.product_id::text=$2)
        AND ($3='' OR m.created_at>=(NULLIF($3,'')::date::timestamp AT TIME ZONE $6))
        AND ($4='' OR m.created_at<((NULLIF($4,'')::date+1)::timestamp AT TIME ZONE $6))
        AND ($5='%%' OR p.name ILIKE $5 OR p.sku ILIKE $5 OR m.notes ILIKE $5 OR m.reason ILIKE $5)
    ), paged AS (SELECT * FROM matched ORDER BY "createdAt" DESC,id DESC LIMIT $7 OFFSET $8)
    SELECT (SELECT count(*)::int FROM matched) AS total,
      COALESCE((SELECT jsonb_agg(paged ORDER BY "createdAt" DESC,id DESC) FROM paged),'[]'::jsonb) AS rows`,
      [
        req.context.store.id,
        filter.productId,
        filter.from,
        filter.to,
        pattern,
        req.context.store.timezone,
        pageSize,
        (filter.page - 1) * pageSize,
      ],
    );
    return { ...result.rows[0], page: filter.page, pageSize };
  }
  @Post('adjustments') @Require('inventory.adjust') async adjust(
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const body = parse(adjustmentSchema, input);
    const { user, store, device } = req.context;
    const requestHash = hash(JSON.stringify({ ...body, employeeId: user.id, deviceId: device.id }));
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${store.id + body.requestId},0))`,
      );
      const [existing] = await tx
        .select()
        .from(movements)
        .where(and(eq(movements.storeId, store.id), eq(movements.requestId, body.requestId)));
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException('This request was already used for a different adjustment.');
        return existing;
      }
      const [product] = await tx
        .select()
        .from(products)
        .where(and(eq(products.id, body.productId), eq(products.storeId, store.id)))
        .for('update');
      if (!product) throw new NotFoundException('Product not found.');
      if (product.baseProductId)
        throw new BadRequestException(
          'Discounted-label stock can only change through its original batch sale or refund.',
        );
      if (!product.active)
        throw new BadRequestException('Activate this product before changing its stock.');
      const change = toScaled(body.quantity, 3);
      if (['piece', 'pack', 'box'].includes(product.unit) && change % 1000n !== 0n)
        throw new BadRequestException('This product needs a whole-number quantity.');
      if (['damaged', 'expired', 'internal_use'].includes(body.reason) && change > 0n)
        throw new BadRequestException('This reason must decrease stock.');
      if (['opening_balance', 'received'].includes(body.reason) && change < 0n)
        throw new BadRequestException('This reason must increase stock.');
      if (
        body.reason === 'opening_balance' &&
        (
          await tx
            .select({ id: movements.id })
            .from(movements)
            .where(eq(movements.productId, product.id))
            .limit(1)
        ).length
      )
        throw new ConflictException(
          'Opening stock has already been recorded. Use a count correction.',
        );
      const next = toScaled(product.stock, 3) + change;
      if (next < 0n)
        throw new BadRequestException(
          'This adjustment would make stock negative. Check the quantity.',
        );
      if (change < 0n) {
        const free = await tx.execute(sql`
          SELECT COALESCE(sum(b.quantity-COALESCE((SELECT count(*) FROM markdown_units u
            JOIN markdowns m ON m.id=u.markdown_id
            WHERE u.store_id=b.store_id AND u.batch_id=b.id AND u.status='AVAILABLE'
              AND m.cancelled_at IS NULL AND (m.valid_until IS NULL OR m.valid_until>now())),0)),0)::text AS quantity
          FROM stock_batches b WHERE b.store_id=${store.id} AND b.product_id=${product.id}
        `);
        if (toScaled(String(free.rows[0].quantity), 3) < -change)
          throw new ConflictException(
            'This adjustment would remove units reserved for markdown labels. Cancel or replace those labels first.',
          );
      }
      const balance = fromScaled(next, 3);
      let costTotal: string | null = null;
      if (change < 0n) {
        const valuation = await tx.execute(sql`
          SELECT consume_adjustment_batches_costed(${store.id}::uuid,${product.id}::uuid,${fromScaled(-change, 3)}::numeric) AS cost
        `);
        costTotal = valuation.rows[0].cost === null ? null : String(valuation.rows[0].cost);
      } else {
        if (product.cost === null)
          throw new BadRequestException('Set purchase cost before adding stock.');
        await tx.execute(
          sql`SELECT adjust_stock_batches(${store.id}::uuid,${product.id}::uuid,${body.quantity}::numeric)`,
        );
      }
      await tx.update(products).set({ stock: balance }).where(eq(products.id, product.id));
      const [movement] = await tx
        .insert(movements)
        .values({
          ...body,
          storeId: store.id,
          employeeId: user.id,
          deviceId: device.id,
          balance,
          costTotal,
          requestHash,
        })
        .returning();
      await tx.insert(audits).values({
        storeId: store.id,
        employeeId: user.id,
        deviceId: device.id,
        action: 'Stock adjusted',
        entityId: product.id,
        details: {
          before: product.stock,
          change: body.quantity,
          after: balance,
          reason: body.reason,
          notes: body.notes,
          movementId: movement.id,
        },
      });
      return movement;
    });
  }
}
@Module({ imports: [AuthModule], controllers: [InventoryController] })
export class InventoryModule {}
