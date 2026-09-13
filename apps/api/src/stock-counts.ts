import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  ParseUUIDPipe,
  Req,
  Module,
  UseGuards,
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { toScaled, fromScaled } from '@eliza/contracts';
import { Database } from './database.js';
import { AuthModule } from './auth.js';
import { Operations, audit } from './operations.js';
import { AccessGuard, Require, parse, hash, cookie, type AuthRequest } from './security.js';
const versionSchema = z.object({ requestId: z.uuid(), version: z.number().int().positive() });
@Controller('stock-counts')
@UseGuards(AccessGuard)
class StockCountsController {
  constructor(
    private database: Database,
    private operations: Operations,
  ) {}
  private actor(req: AuthRequest) {
    return {
      storeId: req.context.store.id,
      employeeId: req.context.user.id,
      deviceId: req.context.device.id,
    };
  }
  private run(
    req: AuthRequest,
    body: { requestId: string } & Record<string, unknown>,
    action: string,
    work: (c: PoolClient) => Promise<unknown>,
  ) {
    const a = this.actor(req),
      digest = hash(JSON.stringify({ body, action, ...a }));
    return this.operations.transaction(async (c) => {
      const permission = action === 'finalize' ? 'counts.finalize' : 'counts.manage';
      const authorized = (
        await c.query(
          `SELECT r.permissions FROM sessions s JOIN employees e ON e.id=s.employee_id JOIN devices d ON d.id=s.device_id JOIN roles r ON r.id=e.role_id WHERE s.token_hash=$1 AND s.expires_at>now() AND e.active AND d.active AND e.store_id=$2 AND d.store_id=$2 AND r.store_id=$2 FOR SHARE OF s,e,d,r`,
          [hash(cookie(req, 'eliza_session')), a.storeId],
        )
      ).rows[0];
      if (!authorized?.permissions.includes(permission))
        throw new ForbiddenException('Your access changed. Sign in again.');
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        a.storeId + body.requestId,
      ]);
      const old = (
        await c.query(
          'SELECT request_hash,result FROM stock_count_commands WHERE store_id=$1 AND request_id=$2',
          [a.storeId, body.requestId],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== digest)
          throw new ConflictException('This request was already used for another change.');
        return old.result;
      }
      const result = await work(c);
      await c.query(
        'INSERT INTO stock_count_commands(store_id,request_id,request_hash,result) VALUES($1,$2,$3,$4)',
        [a.storeId, body.requestId, digest, JSON.stringify(result)],
      );
      return result;
    });
  }
  private async lock(c: PoolClient, id: string, req: AuthRequest, version: number) {
    const row = (
      await c.query('SELECT * FROM stock_counts WHERE id=$1 AND store_id=$2 FOR UPDATE', [
        id,
        req.context.store.id,
      ])
    ).rows[0];
    if (!row) throw new NotFoundException('Stock count not found.');
    if (row.version !== version)
      throw new ConflictException('This count changed. Refresh before continuing.');
    return row;
  }
  private async detail(c: PoolClient, id: string, store: string) {
    const count = (
      await c.query(
        `SELECT c.*,e.name AS creator,f.name AS finalizer FROM stock_counts c JOIN employees e ON e.id=c.created_by LEFT JOIN employees f ON f.id=c.finalized_by WHERE c.id=$1 AND c.store_id=$2`,
        [id, store],
      )
    ).rows[0];
    if (!count) throw new NotFoundException('Stock count not found.');
    const lines = (
      await c.query(
        `SELECT l.*,e.name AS counter,(l.counted_quantity-l.system_quantity)::text AS difference,p.stock AS current_quantity,
 (SELECT count(*) FROM movements m WHERE m.product_id=l.product_id)<>l.movement_count AS stock_changed
 FROM stock_count_lines l JOIN products p ON p.id=l.product_id LEFT JOIN employees e ON e.id=l.counted_by WHERE l.count_id=$1 ORDER BY l.sku`,
        [id],
      )
    ).rows;
    return { ...count, lines };
  }
  @Get() @Require('inventory.read') async list(@Req() req: AuthRequest) {
    return (
      await this.database.pool.query(
        `SELECT c.id,c.name,c.notes,c.status,c.version,c.created_at,c.finalized_at,
e.name AS creator,f.name AS finalizer,
(SELECT count(*)::int FROM stock_count_lines l WHERE l.count_id=c.id) AS "productCount"
FROM stock_counts c JOIN employees e ON e.id=c.created_by
LEFT JOIN employees f ON f.id=c.finalized_by
WHERE c.store_id=$1 ORDER BY c.created_at DESC LIMIT 100`,
        [req.context.store.id],
      )
    ).rows;
  }
  @Get(':id') @Require('inventory.read') async get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    const c = await this.database.pool.connect();
    try {
      return await this.detail(c, id, req.context.store.id);
    } finally {
      c.release();
    }
  }
  @Post() @Require('counts.manage') create(@Body() input: unknown, @Req() req: AuthRequest) {
    const b = parse(
      z.object({
        requestId: z.uuid(),
        name: z.string().trim().min(1).max(120),
        notes: z.string().trim().max(1000).default(''),
        productIds: z
          .array(z.uuid())
          .min(1)
          .max(500)
          .refine((v) => new Set(v).size === v.length),
      }),
      input,
    );
    return this.run(req, b, 'create', async (c) => {
      if (
        (
          await c.query(
            "SELECT id FROM stock_counts WHERE store_id=$1 AND status IN ('draft','counting','review')",
            [req.context.store.id],
          )
        ).rowCount
      )
        throw new ConflictException(
          'Finish or cancel the current stock count before creating another.',
        );
      const rows = (
        await c.query(
          'SELECT * FROM products WHERE id=ANY($1::uuid[]) AND store_id=$2 ORDER BY id FOR SHARE',
          [b.productIds, req.context.store.id],
        )
      ).rows;
      if (rows.length !== b.productIds.length)
        throw new BadRequestException('Choose products from this store.');
      const count = (
        await c.query(
          'INSERT INTO stock_counts(store_id,name,notes,created_by,device_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
          [req.context.store.id, b.name, b.notes, req.context.user.id, req.context.device.id],
        )
      ).rows[0];
      for (const p of rows)
        await c.query(
          'INSERT INTO stock_count_lines(store_id,count_id,product_id,product_name,sku,unit) VALUES($1,$2,$3,$4,$5,$6)',
          [req.context.store.id, count.id, p.id, p.name, p.sku, p.unit],
        );
      await audit(c, this.actor(req), 'Stock count created', count.id, {
        name: b.name,
        products: b.productIds,
      });
      return this.detail(c, count.id, req.context.store.id);
    });
  }
  @Post(':id/action') @Require('counts.manage') action(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(
      versionSchema.extend({
        action: z.enum(['start', 'review', 'recount', 'cancel']),
        reason: z.string().trim().max(500).default(''),
      }),
      input,
    );
    return this.run(req, { ...b, id }, b.action, async (c) => {
      const count = await this.lock(c, id, req, b.version);
      let status: string;
      if (b.action === 'start' || b.action === 'recount') {
        if (
          b.action === 'start'
            ? count.status !== 'draft'
            : !['counting', 'review'].includes(count.status)
        )
          throw new ConflictException('This count cannot be started or recounted now.');
        const products = (
          await c.query(
            'SELECT p.id,p.stock FROM products p JOIN stock_count_lines l ON l.product_id=p.id WHERE l.count_id=$1 ORDER BY p.id FOR UPDATE OF p',
            [id],
          )
        ).rows;
        for (const p of products)
          await c.query(
            'UPDATE stock_count_lines SET system_quantity=$2,movement_count=(SELECT count(*) FROM movements WHERE product_id=$3),counted_quantity=NULL,counted_by=NULL,counted_at=NULL WHERE count_id=$1 AND product_id=$3',
            [id, p.stock, p.id],
          );
        status = 'counting';
      } else if (b.action === 'review') {
        if (count.status !== 'counting')
          throw new ConflictException('Only a count in progress can be reviewed.');
        if (
          (
            await c.query(
              'SELECT id FROM stock_count_lines WHERE count_id=$1 AND counted_quantity IS NULL LIMIT 1',
              [id],
            )
          ).rowCount
        )
          throw new BadRequestException(
            'Enter and save a quantity for every product, including zero.',
          );
        status = 'review';
      } else {
        if (!['draft', 'counting', 'review'].includes(count.status))
          throw new ConflictException('This count is already complete.');
        if (!b.reason) throw new BadRequestException('Enter a cancellation reason.');
        status = 'cancelled';
      }
      await c.query(
        "UPDATE stock_counts SET status=$2,version=version+1,started_at=CASE WHEN $2='counting' THEN now() ELSE started_at END WHERE id=$1",
        [id, status],
      );
      await audit(c, this.actor(req), 'Stock count ' + b.action, id, { reason: b.reason });
      return this.detail(c, id, req.context.store.id);
    });
  }
  @Post(':id/quantities') @Require('counts.manage') save(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(
      versionSchema.extend({
        lines: z
          .array(
            z.object({ productId: z.uuid(), quantity: z.string().regex(/^\d{1,9}(\.\d{1,3})?$/) }),
          )
          .min(1)
          .max(500)
          .refine((v) => new Set(v.map((l) => l.productId)).size === v.length),
      }),
      input,
    );
    return this.run(req, { ...b, id }, 'save', async (c) => {
      const count = await this.lock(c, id, req, b.version);
      if (count.status !== 'counting')
        throw new ConflictException('Only counts in progress accept quantities.');
      const changes = [];
      for (const entry of b.lines) {
        const line = (
          await c.query('SELECT * FROM stock_count_lines WHERE count_id=$1 AND product_id=$2', [
            id,
            entry.productId,
          ])
        ).rows[0];
        if (!line) throw new BadRequestException('Product is outside this count.');
        if (['piece', 'pack', 'box'].includes(line.unit) && toScaled(entry.quantity, 3) % 1000n)
          throw new BadRequestException('This product requires a whole-number quantity.');
        await c.query(
          'UPDATE stock_count_lines SET counted_quantity=$2,counted_by=$3,counted_at=now() WHERE id=$1',
          [line.id, entry.quantity, req.context.user.id],
        );
        changes.push({
          productId: entry.productId,
          before: line.counted_quantity,
          after: entry.quantity,
        });
      }
      await c.query('UPDATE stock_counts SET version=version+1 WHERE id=$1', [id]);
      await audit(c, this.actor(req), 'Stock count quantities saved', id, { changes });
      return this.detail(c, id, req.context.store.id);
    });
  }
  @Post(':id/finalize') @Require('counts.finalize') finalize(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(versionSchema, input);
    return this.run(req, { ...b, id }, 'finalize', async (c) => {
      const count = await this.lock(c, id, req, b.version);
      if (count.status !== 'review')
        throw new ConflictException('Review the count before finalizing.');
      const lines = (
        await c.query(
          'SELECT l.*,p.stock FROM stock_count_lines l JOIN products p ON p.id=l.product_id WHERE count_id=$1 ORDER BY p.id FOR UPDATE OF p',
          [id],
        )
      ).rows;
      const changes = [];
      for (const l of lines) {
        const movements = (
          await c.query('SELECT count(*)::text AS count FROM movements WHERE product_id=$1', [
            l.product_id,
          ])
        ).rows[0].count;
        if (
          l.counted_quantity === null ||
          movements !== l.movement_count ||
          toScaled(l.stock, 3) !== toScaled(l.system_quantity, 3)
        )
          throw new ConflictException(
            'Stock moved during this count. Restart the count and recount the selected products before finalizing.',
          );
        const difference = toScaled(l.counted_quantity, 3) - toScaled(l.system_quantity, 3);
        if (!difference) continue;
        await c.query('UPDATE products SET stock=$2 WHERE id=$1', [
          l.product_id,
          l.counted_quantity,
        ]);
        await c.query(
          "INSERT INTO movements(store_id,product_id,employee_id,device_id,quantity,balance,reason,notes,request_id,request_hash,stock_count_id) VALUES($1,$2,$3,$4,$5,$6,'stock_count',$7,$8,$9,$10)",
          [
            req.context.store.id,
            l.product_id,
            req.context.user.id,
            req.context.device.id,
            fromScaled(difference, 3),
            l.counted_quantity,
            count.name,
            randomUUID(),
            hash(id + l.product_id),
            id,
          ],
        );
        changes.push({
          productId: l.product_id,
          before: l.system_quantity,
          after: l.counted_quantity,
          difference: fromScaled(difference, 3),
        });
      }
      await c.query(
        "UPDATE stock_counts SET status='finalized',version=version+1,finalized_at=now(),finalized_by=$2 WHERE id=$1",
        [id, req.context.user.id],
      );
      await audit(c, this.actor(req), 'Stock count finalized', id, { changes });
      return this.detail(c, id, req.context.store.id);
    });
  }
}
@Module({ imports: [AuthModule], controllers: [StockCountsController], providers: [Operations] })
export class StockCountsModule {}
