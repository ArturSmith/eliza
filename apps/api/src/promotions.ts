import {
  BadRequestException,
  Body,
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
import { z } from 'zod';
import { money, toScaled } from '@eliza/contracts';
import { AuthModule } from './auth.js';
import { Database } from './database.js';
import { AccessGuard, parse, Require, type AuthRequest } from './security.js';

const createInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    discountType: z.enum(['PERCENTAGE', 'FIXED_PRICE']),
    discountValue: money,
    productIds: z.array(z.uuid()).default([]),
    categoryIds: z.array(z.uuid()).default([]),
    startsAt: z.iso.datetime({ offset: true }).optional(),
    endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
    startsAtLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
      .optional(),
    endsAtLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
      .optional(),
  })
  .refine(
    (v) => v.productIds.length + v.categoryIds.length > 0,
    'Choose at least one product or category.',
  )
  .refine(
    (v) => v.discountType !== 'PERCENTAGE' || toScaled(v.discountValue, 2) <= 10000n,
    'Percentage cannot exceed 100%.',
  )
  .refine(
    (v) => !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt ?? Date.now()),
    'End must be after start.',
  );

@Controller('promotions')
@UseGuards(AccessGuard)
export class PromotionsController {
  constructor(private database: Database) {}
  @Get('categories') @Require('catalog.read') async categories(@Req() req: AuthRequest) {
    return (
      await this.database.pool.query(
        'SELECT id,name FROM categories WHERE store_id=$1 ORDER BY name,id',
        [req.context.store.id],
      )
    ).rows;
  }
  @Get() @Require('promotions.manage') async list(@Req() req: AuthRequest) {
    return (
      await this.database.pool.query(
        `SELECT r.id,r.name,r.discount_type AS "discountType",r.discount_value::text AS "discountValue",
        r.starts_at AS "startsAt",r.ends_at AS "endsAt",r.enabled,r.cancelled_at AS "cancelledAt",
        COALESCE((SELECT jsonb_agg(pp.product_id) FROM promotion_products pp WHERE pp.promotion_id=r.id),'[]'::jsonb) AS "productIds",
        COALESCE((SELECT jsonb_agg(pc.category_id) FROM promotion_categories pc WHERE pc.promotion_id=r.id),'[]'::jsonb) AS "categoryIds"
       FROM promotions r WHERE r.store_id=$1 ORDER BY r.created_at DESC,r.id`,
        [req.context.store.id],
      )
    ).rows;
  }
  @Post() @Require('promotions.manage') async create(
    @Req() req: AuthRequest,
    @Body() input: unknown,
  ) {
    const body = parse(createInput, input);
    const store = req.context.store.id;
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const products = [...new Set(body.productIds)];
      const categories = [...new Set(body.categoryIds)];
      const productCount = (
        await client.query(
          'SELECT count(*)::integer AS count FROM products WHERE store_id=$1 AND id=ANY($2::uuid[]) AND base_product_id IS NULL',
          [store, products],
        )
      ).rows[0].count;
      const categoryCount = (
        await client.query(
          'SELECT count(*)::integer AS count FROM categories WHERE store_id=$1 AND id=ANY($2::uuid[])',
          [store, categories],
        )
      ).rows[0].count;
      if (productCount !== products.length || categoryCount !== categories.length)
        throw new BadRequestException('A target does not belong to this store.');
      const localTime = async (value: string | undefined) =>
        value
          ? ((
              await client.query('SELECT ($1::timestamp AT TIME ZONE $2) AS value', [
                value,
                req.context.store.timezone,
              ])
            ).rows[0].value as Date)
          : null;
      const startsAt =
        (await localTime(body.startsAtLocal)) ?? new Date(body.startsAt ?? Date.now());
      const endsAt =
        (await localTime(body.endsAtLocal)) ?? (body.endsAt ? new Date(body.endsAt) : null);
      if (endsAt && endsAt <= startsAt) throw new BadRequestException('End must be after start.');
      const row = (
        await client.query(
          `INSERT INTO promotions(store_id,name,discount_type,discount_value,starts_at,ends_at,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [
            store,
            body.name,
            body.discountType,
            body.discountValue,
            startsAt,
            endsAt,
            req.context.user.id,
          ],
        )
      ).rows[0];
      for (const id of products)
        await client.query(
          'INSERT INTO promotion_products(store_id,promotion_id,product_id) VALUES($1,$2,$3)',
          [store, row.id, id],
        );
      for (const id of categories)
        await client.query(
          'INSERT INTO promotion_categories(store_id,promotion_id,category_id) VALUES($1,$2,$3)',
          [store, row.id, id],
        );
      await client.query(
        'INSERT INTO audits(store_id,employee_id,device_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',
        [
          store,
          req.context.user.id,
          req.context.device.id,
          'Promotion created',
          row.id,
          JSON.stringify(body),
        ],
      );
      await client.query('COMMIT');
      return { id: row.id };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  @Post(':id/cancel') @Require('promotions.manage') async cancel(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const store = req.context.store.id;
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (
        await client.query(
          'UPDATE promotions SET cancelled_at=now(),updated_at=now() WHERE id=$1 AND store_id=$2 AND cancelled_at IS NULL RETURNING id',
          [id, store],
        )
      ).rows[0];
      if (!row) throw new NotFoundException('Active promotion not found.');
      await client.query(
        'INSERT INTO audits(store_id,employee_id,device_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',
        [store, req.context.user.id, req.context.device.id, 'Promotion cancelled', id, '{}'],
      );
      await client.query('COMMIT');
      return { id };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
@Module({ imports: [AuthModule], controllers: [PromotionsController] })
export class PromotionsModule {}
