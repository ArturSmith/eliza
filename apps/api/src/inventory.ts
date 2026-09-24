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
  Req,
  UseGuards,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { adjustmentSchema, fromScaled, toScaled } from '@eliza/contracts';
import { Database } from './database.js';
import { AccessGuard, type AuthRequest, hash, parse, Require } from './security.js';
import { AuthModule } from './auth.js';
import { audits, devices, employees, movements, products } from './schema.js';
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
       CASE WHEN b.expiry_date IS NOT NULL AND b.expiry_date<=(now() AT TIME ZONE s.timezone)::date
       THEN true ELSE false END AS expired
       FROM stock_batches b JOIN stores s ON s.id=b.store_id
       WHERE b.store_id=$1 AND b.product_id=$2 AND b.quantity>0
       ORDER BY b.expiry_date ASC NULLS LAST,b.created_at,b.id`,
      [req.context.store.id, id],
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
        device: devices.name,
        createdAt: movements.createdAt,
      })
      .from(movements)
      .innerJoin(products, eq(movements.productId, products.id))
      .innerJoin(employees, eq(movements.employeeId, employees.id))
      .innerJoin(devices, eq(movements.deviceId, devices.id))
      .where(eq(movements.storeId, req.context.store.id))
      .orderBy(desc(movements.createdAt))
      .limit(100);
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
      const balance = fromScaled(next, 3);
      await tx.execute(
        sql`SELECT adjust_stock_batches(${store.id}::uuid,${product.id}::uuid,${body.quantity}::numeric)`,
      );
      await tx.update(products).set({ stock: balance }).where(eq(products.id, product.id));
      const [movement] = await tx
        .insert(movements)
        .values({
          ...body,
          storeId: store.id,
          employeeId: user.id,
          deviceId: device.id,
          balance,
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
