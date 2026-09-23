import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { and, eq, asc, sql } from 'drizzle-orm';
import { productSchema, productSku } from '@eliza/contracts';
import { z } from 'zod';
import { Database } from './database.js';
import { AccessGuard, type AuthRequest, parse, Require } from './security.js';
import { AuthModule } from './auth.js';
import { products, barcodes, audits } from './schema.js';
import { lookupBarcode } from './barcode-lookup.js';
@Controller('products')
@UseGuards(AccessGuard)
export class CatalogController {
  constructor(private database: Database) {}
  @Get('next-plu') @Require('catalog.write') async nextPlu(@Req() req: AuthRequest) {
    return (
      await this.database.pool.query(
        "SELECT (COALESCE(max(CASE WHEN plu ~ '^[0-9]+$' THEN plu::numeric END),0)+1)::text AS plu FROM products WHERE store_id=$1",
        [req.context.store.id],
      )
    ).rows[0];
  }
  @Get('lookup/:barcode') @Require('catalog.write') async lookup(
    @Param('barcode') barcode: string,
    @Req() req: AuthRequest,
  ) {
    if (!barcode || barcode.length > 100) throw new BadRequestException('Enter a barcode.');
    const existing = await this.database.pool.query(
      'SELECT p.id,p.name FROM products p JOIN barcodes b ON b.product_id=p.id AND b.store_id=p.store_id WHERE p.store_id=$1 AND b.value=$2',
      [req.context.store.id, barcode],
    );
    if (existing.rows.length) return { existing: existing.rows[0] };
    return { suggestion: await lookupBarcode(barcode, this.database) };
  }
  @Get() @Require('catalog.read') async list(@Req() req: AuthRequest) {
    const rows = await this.database.db
      .select()
      .from(products)
      .where(eq(products.storeId, req.context.store.id))
      .orderBy(asc(products.name));
    const codes = await this.database.db
      .select()
      .from(barcodes)
      .where(eq(barcodes.storeId, req.context.store.id));
    return rows.map((p) => ({
      ...p,
      cost: req.context.user.permissions.includes('costs.read') ? p.cost : null,
      plu: p.plu ?? '',
      barcodes: codes.filter((b) => b.productId === p.id).map((b) => b.value),
    }));
  }
  @Post() @Require('catalog.write') async create(@Body() input: unknown, @Req() req: AuthRequest) {
    const defaults = (
      await this.database.pool.query('SELECT default_tax_rate FROM stores WHERE id=$1', [
        req.context.store.id,
      ])
    ).rows[0];
    const {
      barcodes: values,
      plu: enteredPlu,
      autoPlu,
      autoSku,
      ...body
    } = parse(
      productSchema.extend({
        autoPlu: z.boolean().default(false),
        autoSku: z.boolean().default(false),
      }),
      typeof input === 'object' && input !== null
        ? { taxRate: defaults.default_tax_rate, ...input }
        : input,
    );
    const { store, user, device } = req.context;
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${store.id} || ':product-codes',0))`,
      );
      let plu = enteredPlu;
      if (autoPlu) {
        const rows = await tx.execute(
          sql`SELECT (COALESCE(max(CASE WHEN plu ~ '^[0-9]+$' THEN plu::numeric END),0)+1)::text AS plu FROM products WHERE store_id=${store.id}`,
        );
        plu = String(rows.rows[0].plu);
        const settings = await tx.execute(
          sql`SELECT scale_barcode FROM stores WHERE id=${store.id}`,
        );
        const scale = settings.rows[0].scale_barcode as { enabled: boolean; productDigits: number };
        if (plu.length > 20 || (scale.enabled && plu.length > scale.productDigits))
          throw new BadRequestException(
            'No automatic PLU fits the configured code length. Enter a PLU manually or review scale settings.',
          );
      }
      if (autoSku) body.sku = productSku(body.name, plu);
      const [product] = await tx
        .insert(products)
        .values({ ...body, plu: plu || null, storeId: store.id })
        .returning();
      if (values.length)
        await tx
          .insert(barcodes)
          .values(values.map((value) => ({ value, productId: product.id, storeId: store.id })));
      await tx.insert(audits).values({
        storeId: store.id,
        employeeId: user.id,
        deviceId: device.id,
        action: 'Product created',
        entityId: product.id,
        details: { ...body, image: body.image ? '[photo added]' : '', plu, barcodes: values },
      });
      return { ...product, plu: plu ?? '', barcodes: values };
    });
  }

  @Patch(':id') @Require('catalog.write') async edit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const { barcodes: values, plu, ...body } = parse(productSchema, input);
    const { store, user, device } = req.context;
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${store.id} || ':product-codes',0))`,
      );
      const [old] = await tx
        .select()
        .from(products)
        .where(and(eq(products.id, id), eq(products.storeId, store.id)))
        .for('update');
      if (!old) throw new NotFoundException('Product not found.');
      if (old.unit !== body.unit)
        throw new BadRequestException(
          'Unit changes require a stock conversion workflow. Create a separate product instead.',
        );
      const previousCodes = await tx
        .select({ value: barcodes.value })
        .from(barcodes)
        .where(eq(barcodes.productId, id));
      const [product] = await tx
        .update(products)
        .set({ ...body, plu: plu || null })
        .where(eq(products.id, id))
        .returning();
      await tx
        .delete(barcodes)
        .where(and(eq(barcodes.productId, id), eq(barcodes.storeId, store.id)));
      if (values.length)
        await tx
          .insert(barcodes)
          .values(values.map((value) => ({ value, productId: id, storeId: store.id })));
      await tx.insert(audits).values({
        storeId: store.id,
        employeeId: user.id,
        deviceId: device.id,
        action: 'Product updated',
        entityId: id,
        details: {
          before: {
            ...old,
            image: old.image ? '[photo present]' : '',
            barcodes: previousCodes.map((b) => b.value),
          },
          after: {
            ...body,
            image: (body.image ?? old.image) ? '[photo present]' : '',
            photoChanged: body.image !== undefined && body.image !== old.image,
            plu,
            barcodes: values,
          },
        },
      });
      return { ...product, plu: plu ?? '', barcodes: values };
    });
  }
  @Delete(':id') @Require('catalog.write') async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    const { store, user, device } = req.context;
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query(
        'SELECT id,name,sku,stock FROM products WHERE id=$1 AND store_id=$2 FOR UPDATE',
        [id, store.id],
      );
      const product = selected.rows[0];
      if (!product) throw new NotFoundException('Product not found.');
      if (Number(product.stock) !== 0)
        throw new ConflictException('This product has stock on hand. Count or adjust it to zero before deleting.');
      await client.query('DELETE FROM barcodes WHERE product_id=$1 AND store_id=$2', [id, store.id]);
      await client.query('DELETE FROM products WHERE id=$1 AND store_id=$2', [id, store.id]);
      await client.query(
        'INSERT INTO audits(store_id,employee_id,device_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',
        [store.id, user.id, device.id, 'Product deleted', id, JSON.stringify({ name: product.name, sku: product.sku })],
      );
      await client.query('COMMIT');
      return { deleted: true };
    } catch (error) {
      await client.query('ROLLBACK');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23503')
        throw new ConflictException('This product is used in sales, purchases, inventory, counts or lists. Deactivate it instead to preserve those records.');
      throw error;
    } finally {
      client.release();
    }
  }
  @Patch(':id/status') @Require('catalog.write') async status(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const { active } = parse(z.object({ active: z.boolean() }), input);
    const { store, user, device } = req.context;
    return this.database.db.transaction(async (tx) => {
      const [previous] = await tx
        .select()
        .from(products)
        .where(and(eq(products.id, id), eq(products.storeId, store.id)))
        .for('update');
      if (!previous) throw new NotFoundException('Product not found.');
      const [product] = await tx
        .update(products)
        .set({ active })
        .where(eq(products.id, id))
        .returning();
      if (previous.active !== active)
        await tx.insert(audits).values({
          storeId: store.id,
          employeeId: user.id,
          deviceId: device.id,
          action: active ? 'Product activated' : 'Product deactivated',
          entityId: id,
          details: { before: previous.active, after: active },
        });
      return product;
    });
  }
}
@Module({ imports: [AuthModule], controllers: [CatalogController] })
export class CatalogModule {}
