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
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { money, toScaled } from '@eliza/contracts';
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
        `SELECT id,name,unit,price::text,tax_rate::text AS "taxRate",regular_price::text AS "regularPrice",price_kind AS "priceKind",stock::text
       FROM products WHERE id=$1 AND store_id=$2 AND base_product_id IS NULL`,
        [id, store],
      )
    ).rows[0];
    if (!product) throw new NotFoundException('Product not found.');
    const batches = (
      await this.database.pool.query(
        `SELECT b.id,b.quantity::text,CASE WHEN $3::boolean THEN b.unit_cost::text END AS "unitCost",b.expiry_date AS "expiryDate",
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
    return { product, batches, offers };
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
      const regularPrice = body.kind === 'discount_all' ? basePrice : null;
      const updated = (
        await client.query(
          `UPDATE products SET price=$3,regular_price=$4,price_kind=$5
         WHERE id=$1 AND store_id=$2 RETURNING id,price::text,regular_price::text AS "regularPrice",price_kind AS "priceKind"`,
          [
            id,
            store,
            body.price,
            regularPrice,
            body.kind === 'regular' ? 'standard' : 'discount_all',
          ],
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

  @Post('limited') @Require('catalog.write') async limited(
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
      const digest = hash(
        JSON.stringify({
          productId: id,
          quantity: body.quantity,
          price: body.price,
        }),
      );
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
        throw new BadRequestException('Quantity-limited barcode labels require whole units.');
      if (toScaled(body.price, 2) >= toScaled(product.price, 2))
        throw new BadRequestException('Discounted price must be below the current selling price.');
      const batches = (
        await client.query(
          `SELECT b.* FROM stock_batches b JOIN stores s ON s.id=b.store_id
           WHERE b.store_id=$1 AND b.product_id=$2 AND b.quantity>=1
             AND (b.expiry_date IS NULL OR b.expiry_date>(now() AT TIME ZONE s.timezone)::date)
           ORDER BY b.expiry_date NULLS LAST,b.created_at,b.id FOR UPDATE OF b`,
          [store, id],
        )
      ).rows;
      let remaining = body.quantity;
      const allocations: { batch: (typeof batches)[number]; quantity: number }[] = [];
      for (const batch of batches) {
        const quantity = Math.min(Math.floor(Number(batch.quantity)), remaining);
        if (quantity > 0) allocations.push({ batch, quantity });
        remaining -= quantity;
        if (!remaining) break;
      }
      if (remaining) throw new ConflictException('Not enough sellable units remain.');
      const labels = [];
      let allocated = 0;
      for (const { batch, quantity } of allocations) {
        const offerId = randomUUID();
        const sku = `${product.sku}-D${offerId.slice(0, 8)}`;
        const barcode = (
          await client.query('SELECT next_internal_product_barcode($1) AS value', [store])
        ).rows[0].value;
        await client.query(
          `INSERT INTO products(id,store_id,name,sku,category,unit,price,cost,min_stock,stock,plu,active,image,description,source,tax_rate,base_product_id,regular_price,price_kind)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,$9,NULL,true,$10,$11,$12,$13,$14,$15,'limited_discount')`,
          [
            offerId,
            store,
            product.name,
            sku,
            product.category,
            product.unit,
            body.price,
            batch.unit_cost,
            quantity,
            product.image,
            product.description,
            product.source,
            product.tax_rate,
            id,
            product.price,
          ],
        );
        await client.query('INSERT INTO barcodes(store_id,product_id,value) VALUES($1,$2,$3)', [
          store,
          offerId,
          barcode,
        ]);
        await client.query(
          `INSERT INTO stock_batches(store_id,product_id,expiry_date,quantity,unit_cost,cost_source,origin_batch_id)
         VALUES($1,$2,$3,$4,$5,'adjustment',$6)`,
          [store, offerId, batch.expiry_date, quantity, batch.unit_cost, batch.id],
        );
        await client.query('UPDATE stock_batches SET quantity=quantity-$2 WHERE id=$1', [
          batch.id,
          quantity,
        ]);
        for (const [productId, delta] of [
          [id, -quantity],
          [offerId, quantity],
        ] as const) {
          const balance =
            productId === id ? Number(product.stock) - allocated - quantity : quantity;
          await client.query(
            `INSERT INTO movements(store_id,product_id,employee_id,device_id,quantity,balance,reason,notes,request_id,request_hash)
           VALUES($1,$2,$3,$4,$5,$6,'price_relabel',$7,$8,$9)`,
            [
              store,
              productId,
              req.context.user.id,
              req.context.device.id,
              delta,
              balance,
              `Relabelled ${quantity} units as ${sku}`,
              randomUUID(),
              offerId,
            ],
          );
        }
        await client.query(
          'INSERT INTO audits(store_id,employee_id,device_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',
          [
            store,
            req.context.user.id,
            req.context.device.id,
            'Limited price labels created',
            offerId,
            JSON.stringify({
              baseProductId: id,
              sourceBatchId: batch.id,
              quantity,
              regularPrice: product.price,
              discountedPrice: body.price,
              barcode,
            }),
          ],
        );
        labels.push({
          id: offerId,
          barcode,
          quantity,
          price: body.price,
          regularPrice: product.price,
          expiryDate: batch.expiry_date,
          name: product.name,
        });
        allocated += quantity;
      }
      await client.query('UPDATE products SET stock=stock-$2 WHERE id=$1', [id, body.quantity]);
      const result = { labels };
      await client.query(
        'INSERT INTO price_action_requests(store_id,request_id,request_hash,result) VALUES($1,$2,$3,$4)',
        [store, body.requestId, digest, JSON.stringify(result)],
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
}

@Module({ imports: [AuthModule], controllers: [PriceActionsController] })
export class PriceActionsModule {}
