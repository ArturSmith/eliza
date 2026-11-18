import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  ParseUUIDPipe,
  Req,
  UseGuards,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { Database } from './database.js';
import { Operations, audit } from './operations.js';
import { AccessGuard, Require, parse, type AuthRequest } from './security.js';
const fields = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
  published: z.boolean(),
});
const columns = `id,title,body,published,published_at AS "publishedAt",version,created_at AS "createdAt",updated_at AS "updatedAt"`;
@Controller('shop-news')
@UseGuards(AccessGuard)
export class ShopNewsController {
  constructor(
    private database: Database,
    private operations: Operations,
  ) {}
  @Get() @Require('promotions.manage') async list(
    @Req() req: AuthRequest,
    @Query() input: unknown,
  ) {
    const q = parse(
      z.object({ offset: z.coerce.number().int().min(0).max(1000000).default(0) }),
      input,
    );
    const rows = (
      await this.database.pool.query(
        `SELECT ${columns} FROM shop_news WHERE store_id=$1 ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET $2`,
        [req.context.store.id, q.offset],
      )
    ).rows;
    return { items: rows.slice(0, 20), hasMore: rows.length > 20 };
  }
  @Post() @Require('promotions.manage') async create(
    @Req() req: AuthRequest,
    @Body() input: unknown,
  ) {
    const b = parse(fields, input);
    return this.operations.transaction(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO shop_news(store_id,title,body,published,published_at) VALUES($1,$2,$3,$4,CASE WHEN $4 THEN now() ELSE NULL END) RETURNING ${columns}`,
          [req.context.store.id, b.title, b.body, b.published],
        )
      ).rows[0];
      await audit(
        c,
        {
          storeId: req.context.store.id,
          employeeId: req.context.user.id,
          deviceId: req.context.device.id,
        },
        'Shop news created',
        row.id,
        b,
      );
      return row;
    });
  }
  @Put(':id') @Require('promotions.manage') async update(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
  ) {
    const b = parse(fields.extend({ version: z.number().int().positive() }), input);
    return this.operations.transaction(async (c) => {
      const row = (
        await c.query(
          `UPDATE shop_news SET title=$3,body=$4,published=$5,published_at=CASE WHEN $5 THEN COALESCE(published_at,now()) ELSE published_at END,version=version+1,updated_at=now() WHERE id=$1 AND store_id=$2 AND version=$6 RETURNING ${columns}`,
          [id, req.context.store.id, b.title, b.body, b.published, b.version],
        )
      ).rows[0];
      if (!row) {
        const exists = (
          await c.query('SELECT id FROM shop_news WHERE id=$1 AND store_id=$2', [
            id,
            req.context.store.id,
          ])
        ).rowCount;
        if (!exists) throw new NotFoundException('News post not found.');
        throw new ConflictException('This news post changed. Reload and try again.');
      }
      await audit(
        c,
        {
          storeId: req.context.store.id,
          employeeId: req.context.user.id,
          deviceId: req.context.device.id,
        },
        'Shop news updated',
        id,
        b,
      );
      return row;
    });
  }
}
