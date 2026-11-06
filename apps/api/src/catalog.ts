import { normalizeProductGallery } from './product-gallery.js';
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
  ForbiddenException,
} from '@nestjs/common';
import { and, eq, asc, isNull, sql } from 'drizzle-orm';
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
      .where(and(eq(products.storeId, req.context.store.id), isNull(products.baseProductId)))
      .orderBy(asc(products.name));
    const codes = await this.database.db
      .select()
      .from(barcodes)
      .where(eq(barcodes.storeId, req.context.store.id));
    const canReadCosts = req.context.user.permissions.includes('costs.read');
    const values = canReadCosts
      ? (
          await this.database.pool.query(
            `SELECT product_id,
              CASE WHEN bool_or(unit_cost IS NULL) THEN NULL ELSE sum(round(quantity*unit_cost,2))::text END AS value,
              CASE WHEN bool_or(unit_cost IS NULL) THEN NULL ELSE round(sum(round(quantity*unit_cost,2))/sum(quantity),2)::text END AS average,
              COALESCE(sum(quantity) FILTER(WHERE unit_cost IS NULL),0)::text AS unknown,
              bool_or(cost_source='legacy_estimate') AS estimated
             FROM stock_batches WHERE store_id=$1 AND quantity>0 GROUP BY product_id`,
            [req.context.store.id],
          )
        ).rows
      : [];
    const latest = canReadCosts ? (await this.database.pool.query(
      `SELECT DISTINCT ON (b.product_id) b.product_id,b.unit_cost::text AS cost,
        b.created_at AS date,s.name AS supplier
       FROM stock_batches b LEFT JOIN goods_receipt_lines l ON l.id=b.receipt_line_id AND l.store_id=b.store_id
       LEFT JOIN goods_receipts g ON g.id=l.receipt_id AND g.store_id=l.store_id
       LEFT JOIN purchases p ON p.id=g.purchase_id AND p.store_id=g.store_id
       LEFT JOIN suppliers s ON s.id=COALESCE(p.supplier_id,b.supplier_id) AND s.store_id=b.store_id
       WHERE b.store_id=$1 AND (b.receipt_line_id IS NOT NULL OR b.supplier_id IS NOT NULL)
       ORDER BY b.product_id,b.created_at DESC,b.id DESC`, [req.context.store.id],
    )).rows : [];
    return rows.map((p) => ({
      ...p,
      cost: canReadCosts ? p.cost : null,
      stockValue: canReadCosts
        ? (values.find((v) => v.product_id === p.id)?.value ?? (Number(p.stock) > 0 ? null : '0.00'))
        : null,
      averageCost: canReadCosts ? values.find((v) => v.product_id === p.id)?.average ?? null : null,
      unknownCostQuantity: canReadCosts ? values.find((v) => v.product_id === p.id)?.unknown ?? '0' : undefined,
      stockCostEstimated: canReadCosts ? values.find((v) => v.product_id === p.id)?.estimated ?? false : undefined,
      lastPurchaseCost: canReadCosts ? latest.find((v) => v.product_id === p.id)?.cost ?? null : null,
      lastPurchaseAt: canReadCosts ? latest.find((v) => v.product_id === p.id)?.date ?? null : null,
      lastPurchaseSupplier: canReadCosts && req.context.user.permissions.includes('suppliers.read') ? latest.find((v) => v.product_id === p.id)?.supplier ?? null : null,
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
      barcodes: providedCodes,
      plu: enteredPlu,
      autoPlu,
      autoSku,
      supplierId,
      ...body
    } = parse(
      productSchema.extend({
        autoPlu: z.boolean().default(false),
        autoSku: z.boolean().default(false),
        supplierId: z.uuid().optional(),
      }),
      typeof input === 'object' && input !== null
        ? { taxRate: defaults.default_tax_rate, ...input }
        : input,
    );
    Object.assign(body, normalizeProductGallery(body));
    const { store, user, device } = req.context;
    if (supplierId && !user.permissions.includes('suppliers.manage'))
      throw new ForbiddenException('You cannot add products to suppliers.');
    return this.database.db.transaction(async (tx) => {
      if (supplierId) {
        const supplier = await tx.execute(sql`SELECT id FROM suppliers WHERE id=${supplierId}
          AND store_id=${store.id} AND active FOR SHARE`);
        if (!supplier.rows.length) throw new BadRequestException('Choose an active supplier.');
      }
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
      const values = providedCodes.length
        ? providedCodes
        : [
            String(
              (await tx.execute(sql`SELECT next_internal_product_barcode(${store.id}) AS value`))
                .rows[0].value,
            ),
          ];
      const [product] = await tx
        .insert(products)
        .values({ ...body, plu: plu || null, storeId: store.id })
        .returning();
      if (values.length)
        await tx
          .insert(barcodes)
          .values(values.map((value) => ({ value, productId: product.id, storeId: store.id })));
      if (supplierId) {
        const linked =
          await tx.execute(sql`INSERT INTO supplier_products(store_id,supplier_id,product_id,pack_cost)
          VALUES(${store.id},${supplierId},${product.id},NULL) RETURNING id`);
        await tx.insert(audits).values({
          storeId: store.id,
          employeeId: user.id,
          deviceId: device.id,
          action: 'Supplier product linked',
          entityId: String(linked.rows[0].id),
          details: { supplierId, productId: product.id },
        });
      }
      await tx.insert(audits).values({
        storeId: store.id,
        employeeId: user.id,
        deviceId: device.id,
        action: 'Product created',
        entityId: product.id,
        details: {
          ...body,
          image: body.image ? '[photo added]' : '',
          images: `[${body.images?.length ?? 0} photos]`,
          plu,
          barcodes: values,
        },
      });
      return {
        ...product,
        cost: req.context.user.permissions.includes('costs.read') ? product.cost : null,
        plu: plu ?? '',
        barcodes: values,
      };
    });
  }
  @Patch(':id') @Require('catalog.write') async edit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const { barcodes: providedCodes, plu, ...body } = parse(productSchema, input);
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
      Object.assign(body, normalizeProductGallery(body, old));
      // A catalog editor without cost access must not clear or overwrite a hidden cost.
      if (!req.context.user.permissions.includes('costs.read') || !Object.prototype.hasOwnProperty.call(input, 'cost')) body.cost = old.cost;
      if (old.baseProductId)
        throw new BadRequestException('Edit limited-price labels from the parent product.');
      if (old.unit !== body.unit)
        throw new BadRequestException(
          'Unit changes require a stock conversion workflow. Create a separate product instead.',
        );
      const previousCodes = await tx
        .select({ value: barcodes.value })
        .from(barcodes)
        .where(eq(barcodes.productId, id));
      const values = providedCodes.length
        ? providedCodes
        : [
            String(
              (await tx.execute(sql`SELECT next_internal_product_barcode(${store.id}) AS value`))
                .rows[0].value,
            ),
          ];
      const [product] = await tx
        .update(products)
        .set({
          ...body,
          plu: plu || null,
          ...(old.priceKind === 'discount_all' && body.price === old.regularPrice
            ? {
                price: old.price,
                regularPrice: old.regularPrice,
                priceKind: 'discount_all' as const,
              }
            : { regularPrice: null, priceKind: 'standard' as const }),
        })
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
            images: `[${old.images.length} photos]`,
            barcodes: previousCodes.map((b) => b.value),
          },
          after: {
            ...body,
            image: (body.image ?? old.image) ? '[photo present]' : '',
            images: `[${body.images?.length ?? old.images.length} photos]`,
            photoChanged: body.image !== undefined && body.image !== old.image,
            plu,
            barcodes: values,
          },
        },
      });
      return { ...product, cost: req.context.user.permissions.includes('costs.read') ? product.cost : null, plu: plu ?? '', barcodes: values };
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
        throw new ConflictException(
          'This product has stock on hand. Count or adjust it to zero before deleting.',
        );
      await client.query('DELETE FROM barcodes WHERE product_id=$1 AND store_id=$2', [
        id,
        store.id,
      ]);
      await client.query('DELETE FROM products WHERE id=$1 AND store_id=$2', [id, store.id]);
      await client.query(
        'INSERT INTO audits(store_id,employee_id,device_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',
        [
          store.id,
          user.id,
          device.id,
          'Product deleted',
          id,
          JSON.stringify({ name: product.name, sku: product.sku }),
        ],
      );
      await client.query('COMMIT');
      return { deleted: true };
    } catch (error) {
      await client.query('ROLLBACK');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23503')
        throw new ConflictException(
          'This product is used in sales, purchases, inventory, counts or lists. Deactivate it instead to preserve those records.',
        );
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
