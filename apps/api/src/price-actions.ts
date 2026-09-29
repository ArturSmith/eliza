import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { money, toScaled } from '@eliza/contracts';
import { reservedByBatch, resolvePrice } from './pricing-engine.js';
import { Database } from './database.js';
import { AccessGuard, hash, parse, Require, type AuthRequest } from './security.js';
import { AuthModule } from './auth.js';

const priceInput = z.object({
  kind: z.enum(['regular', 'discount_all']),
  price: money,
});
const limitedInput = z.object({
  requestId: z.uuid(),
  quantity: z.number().int().positive().max(500),
  price: money,
  reason: z
    .enum(['EXPIRING_SOON', 'DAMAGED_PACKAGING', 'CLEARANCE', 'OVERSTOCK', 'OTHER'])
    .default('OTHER'),
  validUntil: z.iso.datetime({ offset: true }).nullable().optional(),
  validUntilLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    .optional(),
});

@Controller('products/:id/pricing')
@UseGuards(AccessGuard)
export class PriceActionsController {
  constructor(private database: Database) {}

  @Get() @Require('catalog.write') async details(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    const store = req.context.store.id;
    const product = (
      await this.database.pool.query(
        `SELECT id,name,unit,category_id,price::text,tax_rate::text AS "taxRate",regular_price::text AS "regularPrice",price_kind AS "priceKind",stock::text
       FROM products WHERE id=$1 AND store_id=$2 AND base_product_id IS NULL`,
        [id, store],
      )
    ).rows[0];
    if (!product) throw new NotFoundException('Product not found.');
    const checkout = await resolvePrice(this.database.pool as any, store, {
      id: product.id,
      price: product.price,
      category_id: product.category_id,
      price_kind: product.priceKind,
    });
    const batches = (
      await this.database.pool.query(
        `SELECT b.id,(b.quantity-COALESCE((SELECT count(*) FROM markdown_units u JOIN markdowns m ON m.id=u.markdown_id
          WHERE u.batch_id=b.id AND u.store_id=b.store_id AND u.status='AVAILABLE'
            AND m.cancelled_at IS NULL AND (m.valid_until IS NULL OR m.valid_until>now())),0))::text AS quantity,
         CASE WHEN $3::boolean THEN b.unit_cost::text END AS "unitCost",b.expiry_date AS "expiryDate",
         b.cost_source AS "costSource",
         (b.expiry_date IS NULL OR b.expiry_date>(now() AT TIME ZONE s.timezone)::date) AS sellable
       FROM stock_batches b JOIN stores s ON s.id=b.store_id
       WHERE b.store_id=$1 AND b.product_id=$2 AND b.quantity>0
       ORDER BY b.expiry_date NULLS LAST,b.created_at,b.id`,
        [store, id, req.context.user.permissions.includes('costs.read')],
      )
    ).rows;
    const offers = (
      await this.database.pool.query(
        `SELECT p.id,p.price::text,p.regular_price::text AS "regularPrice",p.stock::text,
         b.expiry_date AS "expiryDate",bc.value AS barcode,
         (b.expiry_date IS NULL OR b.expiry_date>(now() AT TIME ZONE s.timezone)::date) AS sellable
       FROM products p JOIN stock_batches b ON b.product_id=p.id AND b.store_id=p.store_id
       JOIN barcodes bc ON bc.product_id=p.id AND bc.store_id=p.store_id
       JOIN stores s ON s.id=p.store_id
       WHERE p.store_id=$1 AND p.base_product_id=$2 AND p.price_kind='limited_discount'
       ORDER BY p.created_at DESC`,
        [store, id],
      )
    ).rows;
    return { product: { ...product, checkoutPrice: checkout.price }, batches, offers };
  }

  @Post() @Require('catalog.write') async change(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const body = parse(priceInput, input);
    const store = req.context.store.id;
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const product = (
        await client.query(
          'SELECT id,name,price::text,regular_price::text AS "regularPrice",price_kind AS "priceKind" FROM products WHERE id=$1 AND store_id=$2 AND base_product_id IS NULL FOR UPDATE',
          [id, store],
        )
      ).rows[0];
      if (!product) throw new NotFoundException('Product not found.');
      const basePrice = product.regularPrice ?? product.price;
      if (body.kind === 'discount_all' && toScaled(body.price, 2) >= toScaled(basePrice, 2))
        throw new BadRequestException('Discounted price must be below the regular price.');
      if (body.kind === 'discount_all') {
        if (!req.context.user.permissions.includes('promotions.manage'))
          throw new ForbiddenException('You cannot manage promotions.');
        await client.query(
          `UPDATE promotions r SET cancelled_at=now(),updated_at=now()
           WHERE r.store_id=$1 AND r.cancelled_at IS NULL
             AND r.origin IN ('PRODUCT_DISCOUNT','MIGRATION')
             AND EXISTS(SELECT 1 FROM promotion_products pp WHERE pp.promotion_id=r.id AND pp.product_id=$2)
             AND NOT EXISTS(SELECT 1 FROM promotion_products pp WHERE pp.promotion_id=r.id AND pp.product_id<>$2)
             AND NOT EXISTS(SELECT 1 FROM promotion_categories pc WHERE pc.promotion_id=r.id)`,
          [store, id],
        );
        const promo = (
          await client.query(
          `INSERT INTO promotions(store_id,name,origin,discount_type,discount_value,created_by)
           VALUES($1,$2,'PRODUCT_DISCOUNT','FIXED_PRICE',$3,$4) RETURNING id`,
            [store, `Product discount: ${product.name}`, body.price, req.context.user.id],
          )
        ).rows[0];
        await client.query(
          'INSERT INTO promotion_products(store_id,promotion_id,product_id) VALUES($1,$2,$3)',
          [store, promo.id, id],
        );
        await client.query(
          'INSERT INTO audits(store_id,employee_id,device_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',
          [
            store,
            req.context.user.id,
            req.context.device.id,
            'Product promotion created',
            promo.id,
            JSON.stringify({ productId: id, price: body.price }),
          ],
        );
        await client.query('COMMIT');
        return { id: promo.id, price: body.price };
      }
      const updated = (
        await client.query(
          `UPDATE products SET price=$3,regular_price=$4,price_kind=$5
         WHERE id=$1 AND store_id=$2 RETURNING id,price::text,regular_price::text AS "regularPrice",price_kind AS "priceKind"`,
          [id, store, body.price, null, 'standard'],
        )
      ).rows[0];
      await client.query(
        'INSERT INTO audits(store_id,employee_id,device_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',
        [
          store,
          req.context.user.id,
          req.context.device.id,
          'Product price changed',
          id,
          JSON.stringify({ before: product, after: updated }),
        ],
      );
      await client.query('COMMIT');
      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @Get('markdowns') @Require('markdowns.manage') async markdowns(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return (
      await this.database.pool.query(
        `SELECT u.id,u.barcode,u.status,u.batch_id AS "batchId",u.sold_at AS "soldAt",
        m.final_unit_price::text AS price,m.base_unit_price::text AS "regularPrice",
        b.expiry_date AS "expiryDate",m.valid_until AS "validUntil"
       FROM markdown_units u JOIN markdowns m ON m.id=u.markdown_id
       JOIN stock_batches b ON b.id=u.batch_id
       WHERE u.store_id=$1 AND u.product_id=$2 ORDER BY u.created_at DESC,u.id`,
        [req.context.store.id, id],
      )
    ).rows;
  }

  @Post('limited') @Require('markdowns.manage') async limited(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const body = parse(limitedInput, input);
    const store = req.context.store.id;
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        store + body.requestId,
      ]);
      const digest = hash(JSON.stringify({ productId: id, ...body }));
      const prior = (
        await client.query(
          'SELECT request_hash,result FROM price_action_requests WHERE store_id=$1 AND request_id=$2',
          [store, body.requestId],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== digest)
          throw new ConflictException('This request was already used for another price action.');
        await client.query('COMMIT');
        return prior.result;
      }
      const product = (
        await client.query(
          'SELECT * FROM products WHERE id=$1 AND store_id=$2 AND base_product_id IS NULL FOR UPDATE',
          [id, store],
        )
      ).rows[0];
      if (!product || !product.active) throw new NotFoundException('Active product not found.');
      if (!['piece', 'pack', 'box'].includes(product.unit))
        throw new BadRequestException('Unit markdown labels require whole units.');
      const base = await resolvePrice(client, store, product);
      if (toScaled(body.price, 2) >= toScaled(base.price, 2))
        throw new BadRequestException('Markdown price must be below the current checkout price.');
      const validUntil = body.validUntilLocal
        ? (
            await client.query('SELECT ($1::timestamp AT TIME ZONE $2) AS value', [
              body.validUntilLocal,
              req.context.store.timezone,
            ])
          ).rows[0].value
        : (body.validUntil ?? null);
      if (validUntil && new Date(validUntil).getTime() <= Date.now())
        throw new BadRequestException('The expiry must be in the future.');
      const batches = (
        await client.query(
          `SELECT b.* FROM stock_batches b JOIN stores s ON s.id=b.store_id
         WHERE b.store_id=$1 AND b.product_id=$2 AND b.quantity>=1
           AND (b.expiry_date IS NULL OR b.expiry_date>(now() AT TIME ZONE s.timezone)::date)
         ORDER BY b.expiry_date NULLS LAST,b.created_at,b.id FOR UPDATE OF b`,
          [store, id],
        )
      ).rows;
      const allocations: string[] = [];
      for (const batch of batches) {
        const reserved = await reservedByBatch(client, store, batch.id);
        let free = Number((toScaled(batch.quantity, 3) - reserved) / 1000n);
        while (free > 0 && allocations.length < body.quantity) {
          allocations.push(batch.id);
          free--;
        }
        if (allocations.length === body.quantity) break;
      }
      if (allocations.length !== body.quantity)
        throw new ConflictException('Not enough unreserved sellable units remain.');
      const markdownId = randomUUID();
      await client.query(
        `INSERT INTO markdowns(id,store_id,product_id,quantity,reason,base_unit_price,final_unit_price,valid_until,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          markdownId,
          store,
          id,
          body.quantity,
          body.reason,
          base.price,
          body.price,
          validUntil,
          req.context.user.id,
        ],
      );
      const labels = [];
      for (const batchId of allocations) {
        const barcode = (await client.query('SELECT next_markdown_barcode() AS value')).rows[0]
          .value;
        const unit = (
          await client.query(
            `INSERT INTO markdown_units(store_id,markdown_id,product_id,batch_id,barcode)
           VALUES($1,$2,$3,$4,$5) RETURNING id`,
            [store, markdownId, id, batchId, barcode],
          )
        ).rows[0];
        const batch = batches.find((row) => row.id === batchId)!;
        labels.push({
          id: unit.id,
          barcode,
          quantity: 1,
          price: body.price,
          regularPrice: base.price,
          expiryDate: batch.expiry_date,
          name: product.name,
        });
      }
      const result = { markdownId, labels };
      await client.query(
        'INSERT INTO price_action_requests(store_id,request_id,request_hash,result) VALUES($1,$2,$3,$4)',
        [store, body.requestId, digest, JSON.stringify(result)],
      );
      await client.query(
        'INSERT INTO audits(store_id,employee_id,device_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',
        [
          store,
          req.context.user.id,
          req.context.device.id,
          'Markdown labels created',
          markdownId,
          JSON.stringify({
            productId: id,
            quantity: body.quantity,
            price: body.price,
            reason: body.reason,
          }),
        ],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @Post('markdowns/:unitId/cancel') @Require('markdowns.manage') async cancelUnit(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Req() req: AuthRequest,
  ) {
    const store = req.context.store.id;
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const product = (
        await client.query('SELECT id FROM products WHERE id=$1 AND store_id=$2 FOR UPDATE', [
          id,
          store,
        ])
      ).rows[0];
      if (!product) throw new NotFoundException('Product not found.');
      const unit = (
        await client.query(
          `UPDATE markdown_units SET status='CANCELLED',cancelled_at=now()
         WHERE id=$1 AND store_id=$2 AND product_id=$3 AND status='AVAILABLE'
         RETURNING id`,
          [unitId, store, id],
        )
      ).rows[0];
      if (!unit) throw new ConflictException('Only an unused markdown label can be cancelled.');
      await client.query(
        'INSERT INTO audits(store_id,employee_id,device_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',
        [
          store,
          req.context.user.id,
          req.context.device.id,
          'Markdown label cancelled',
          unitId,
          '{}',
        ],
      );
      await client.query('COMMIT');
      return { id: unitId };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  @Post('markdowns/:unitId/replace') @Require('markdowns.manage') async replaceUnit(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Req() req: AuthRequest,
  ) {
    const store = req.context.store.id;
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const product = (
        await client.query('SELECT id,name FROM products WHERE id=$1 AND store_id=$2 FOR UPDATE', [
          id,
          store,
        ])
      ).rows[0];
      if (!product) throw new NotFoundException('Product not found.');
      const old = (
        await client.query(
          `SELECT u.*,m.final_unit_price::text AS price,m.base_unit_price::text AS "regularPrice",
          m.valid_until,b.expiry_date AS "expiryDate"
         FROM markdown_units u JOIN markdowns m ON m.id=u.markdown_id
         JOIN stock_batches b ON b.id=u.batch_id
         JOIN stores s ON s.id=u.store_id
         WHERE u.id=$1 AND u.store_id=$2 AND u.product_id=$3
           AND u.status='AVAILABLE' AND m.cancelled_at IS NULL
           AND (m.valid_until IS NULL OR m.valid_until>now())
           AND (b.expiry_date IS NULL OR b.expiry_date>(now() AT TIME ZONE s.timezone)::date)
         FOR UPDATE OF u`,
          [unitId, store, id],
        )
      ).rows[0];
      if (!old) throw new ConflictException('This markdown label cannot be replaced.');
      await client.query(
        `UPDATE markdown_units SET status='CANCELLED',cancelled_at=now() WHERE id=$1`,
        [unitId],
      );
      const barcode = (await client.query('SELECT next_markdown_barcode() AS value')).rows[0].value;
      const row = (
        await client.query(
          `INSERT INTO markdown_units(store_id,markdown_id,product_id,batch_id,barcode,replacement_for_id)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
          [store, old.markdown_id, id, old.batch_id, barcode, unitId],
        )
      ).rows[0];
      await client.query(
        'INSERT INTO audits(store_id,employee_id,device_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',
        [
          store,
          req.context.user.id,
          req.context.device.id,
          'Markdown label replaced',
          row.id,
          JSON.stringify({ replaces: unitId }),
        ],
      );
      await client.query('COMMIT');
      return {
        label: {
          id: row.id,
          barcode,
          quantity: 1,
          price: old.price,
          regularPrice: old.regularPrice,
          expiryDate: old.expiryDate,
          name: product.name,
        },
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

@Module({ imports: [AuthModule], controllers: [PriceActionsController] })
export class PriceActionsModule {}
