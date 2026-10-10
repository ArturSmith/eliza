import {
  Body,
  ConflictException,
  Controller,
  Get,
  Module,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { storeLayoutSchema } from '@eliza/contracts';
import { Database } from './database.js';
import { AuthModule } from './auth.js';
import { AccessGuard, Require, parse, type AuthRequest } from './security.js';
import { Operations, audit } from './operations.js';

@Controller('store-layout')
@UseGuards(AccessGuard)
class StoreLayoutController {
  constructor(
    private database: Database,
    private operations: Operations,
  ) {}
  @Get() @Require('settings.manage') async get(@Req() req: AuthRequest) {
    return (
      (
        await this.database.pool.query(
          'SELECT layout,version FROM store_layouts WHERE store_id=$1',
          [req.context.store.id],
        )
      ).rows[0] ?? { layout: { width: 12, length: 16, objects: [] }, version: 0 }
    );
  }
  @Post() @Require('settings.manage') async save(@Body() input: unknown, @Req() req: AuthRequest) {
    const body = parse(
      z.object({ layout: storeLayoutSchema, version: z.number().int().min(0) }),
      input,
    );
    return this.operations.transaction(async (c) => {
      // Serialize first saves as well as updates across managers of the same store.
      await c.query('SELECT id FROM stores WHERE id=$1 FOR UPDATE', [req.context.store.id]);
      const old = (
        await c.query('SELECT layout,version FROM store_layouts WHERE store_id=$1', [
          req.context.store.id,
        ])
      ).rows[0];
      if ((old?.version ?? 0) !== body.version)
        throw new ConflictException('Store layout changed. Reload before saving.');
      const saved = (
        await c.query(
          `INSERT INTO store_layouts(store_id,layout) VALUES($1,$2::jsonb)
        ON CONFLICT(store_id) DO UPDATE SET layout=EXCLUDED.layout,version=store_layouts.version+1,updated_at=now()
        RETURNING layout,version`,
          [req.context.store.id, JSON.stringify(body.layout)],
        )
      ).rows[0];
      await audit(
        c,
        {
          storeId: req.context.store.id,
          employeeId: req.context.user.id,
          deviceId: req.context.device.id,
        },
        'Store layout updated',
        req.context.store.id,
        { before: old?.layout ?? null, after: saved.layout },
      );
      return saved;
    });
  }
}
@Module({ imports: [AuthModule], controllers: [StoreLayoutController], providers: [Operations] })
export class StoreLayoutModule {}
