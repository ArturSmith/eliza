import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Param,
  ParseUUIDPipe,
  Req,
  Module,
  UseGuards,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { toScaled, fromScaled, approvalSchema, type Receipt } from '@eliza/contracts';
import { AuthModule } from './auth.js';
import { Database } from './database.js';
import { AccessGuard, Require, parse, hash, type AuthRequest } from './security.js';
import { RegisterModule, RegisterService } from './register.js';
import { Operations, audit } from './operations.js';
import { restockSaleBatches } from './stock-batches.js';
const calendar = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
const searchSchema = z
  .object({
    q: z.string().trim().max(120).default(''),
    from: calendar.optional(),
    to: calendar.optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'Start date must not follow end date');
async function search(c: PoolClient, store: string, zone: string, input: unknown) {
  const b = parse(searchSchema, input);
  const rows = (
    await c.query(
      `SELECT receipt FROM sales WHERE store_id=$1
 AND ($2='' OR strpos(lower(receipt_number),lower($2))>0 OR id::text=$2)
 AND ($3::date IS NULL OR created_at>=($3::date::timestamp AT TIME ZONE $5))
 AND ($4::date IS NULL OR created_at<(($4::date+1)::timestamp AT TIME ZONE $5))
 ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET $6`,
      [store, b.q, b.from ?? null, b.to ?? null, zone, (b.page - 1) * 50],
    )
  ).rows;
  return {
    receipts: rows.slice(0, 50).map((r) => r.receipt),
    hasMore: rows.length > 50,
    page: b.page,
  };
}
async function detail(c: PoolClient, id: string, store: string) {
  const sale = (await c.query('SELECT receipt FROM sales WHERE id=$1 AND store_id=$2', [id, store]))
    .rows[0];
  if (!sale) throw new NotFoundException('Receipt not found.');
  const returned = (
    await c.query(
      'SELECT product_id AS "productId",sale_item_id AS "saleItemId",sum(quantity)::text AS quantity FROM refund_lines WHERE sale_id=$1 AND store_id=$2 GROUP BY product_id,sale_item_id',
      [id, store],
    )
  ).rows;
  const refunds = (
    await c.query(
      'SELECT receipt FROM refunds WHERE sale_id=$1 AND store_id=$2 ORDER BY created_at DESC',
      [id, store],
    )
  ).rows.map((r) => r.receipt);
  return { receipt: sale.receipt, returned, refunds };
}
@Controller('reports')
@UseGuards(AccessGuard)
class ReceiptSearchController {
  constructor(private database: Database) {}
  @Get('receipt-search') @Require('sales.read') async search(
    @Query() q: unknown,
    @Req() req: AuthRequest,
  ) {
    const c = await this.database.pool.connect();
    try {
      return await search(c, req.context.store.id, req.context.store.timezone, q);
    } finally {
      c.release();
    }
  }
  @Get('receipt-search/:id') @Require('sales.read') async detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    const c = await this.database.pool.connect();
    try {
      return await detail(c, id, req.context.store.id);
    } finally {
      c.release();
    }
  }
}
const refundSchema = z.object({
  requestId: z.uuid(),
  saleId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
  method: z.enum(['cash', 'card']),
  confirmed: z.literal(true),
  approval: approvalSchema.optional(),
  lines: z
    .array(
      z.object({
        productId: z.uuid(),
        saleItemId: z.uuid().optional(),
        quantity: z
          .string()
          .regex(/^\d{1,9}(\.\d{1,3})?$/)
          .refine((v) => toScaled(v, 3) > 0n),
        restock: z.boolean(),
      }),
    )
    .min(1)
    .max(100)
    .refine((v) => new Set(v.map((l) => l.saleItemId ?? l.productId)).size === v.length),
});
@Controller('pos')
class RefundController {
  constructor(
    private registers: RegisterService,
    private operations: Operations,
  ) {}
  @Get('receipt-search') search(@Query() q: unknown, @Req() req: Request) {
    return this.operations.transaction(async (c) => {
      const a = await this.registers.operator(c, req);
      return search(c, a.storeId, a.timezone, q);
    });
  }
  @Get('receipt-search/:id') detail(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.operations.transaction(async (c) => {
      const a = await this.registers.operator(c, req);
      return detail(c, id, a.storeId);
    });
  }
  @Post('receipt-search/:id/reprint') reprint(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.operations.transaction(async (c) => {
      const a = await this.registers.operator(c, req);
      await detail(c, id, a.storeId);
      await audit(c, a, 'Receipt reprinted', id, {});
      return { ok: true };
    });
  }
  @Post('refunds') refund(@Body() input: unknown, @Req() req: Request) {
    const b = parse(refundSchema, input);
    return this.operations.transaction(async (c) => {
      const a = await this.registers.operator(c, req);
      const { approval, ...payload } = b;
      const digest = hash(JSON.stringify({ payload, employee: a.employeeId, device: a.deviceId }));
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        a.storeId + b.requestId,
      ]);
      const old = (
        await c.query(
          'SELECT receipt,request_hash FROM refunds WHERE store_id=$1 AND request_id=$2',
          [a.storeId, b.requestId],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== digest)
          throw new ConflictException('This request was already used for another refund.');
        return old.receipt;
      }
      const shift = (
        await c.query(
          "SELECT * FROM shifts WHERE device_id=$1 AND employee_id=$2 AND store_id=$3 AND status='open' FOR UPDATE",
          [a.deviceId, a.employeeId, a.storeId],
        )
      ).rows[0];
      if (!shift) throw new ConflictException('Start a shift before issuing a refund.');
      let approver = { id: a.employeeId, name: a.name };
      if (!a.permissions.includes('refund.approve')) {
        if (!approval) throw new ForbiddenException('A manager must approve this refund.');
        const manager = await this.registers.checkPin(
          c,
          a.deviceId,
          a.storeId,
          approval,
          'refund.approve',
        );
        if (manager instanceof HttpException) return manager;
        approver = manager;
      }
      const sale = (
        await c.query('SELECT receipt FROM sales WHERE id=$1 AND store_id=$2 FOR UPDATE', [
          b.saleId,
          a.storeId,
        ])
      ).rows[0];
      if (!sale) throw new NotFoundException('Receipt not found.');
      const original = sale.receipt as Receipt;
      if (original.payment.method !== b.method)
        throw new BadRequestException('Use the original payment method for this refund.');
      let total = 0n,
        tax = 0n;
      const lines = [];
      const nextBalances = new Map<string, bigint>();
      for (const entry of [...b.lines].sort((x, y) => x.productId.localeCompare(y.productId))) {
        const line = original.lines.find((l) =>
          entry.saleItemId
            ? l.saleItemId === entry.saleItemId && l.productId === entry.productId
            : l.productId === entry.productId,
        );
        if (!line) throw new BadRequestException('This product is not on the original receipt.');
        const qty = toScaled(entry.quantity, 3),
          sold = toScaled(line.quantity, 3);
        if (['piece', 'pack', 'box'].includes(line.unit) && qty % 1000n)
          throw new BadRequestException('Use a whole-number return quantity.');
        const prior = (
          await c.query(
            'SELECT COALESCE(sum(quantity),0)::text AS quantity FROM refund_lines WHERE sale_id=$1 AND product_id=$2 AND ($3::uuid IS NULL OR sale_item_id=$3)',
            [b.saleId, entry.productId, entry.saleItemId ?? null],
          )
        ).rows[0];
        const before = toScaled(prior.quantity, 3),
          after = before + qty;
        if (after > sold)
          throw new ConflictException(
            'Return quantity exceeds the remaining quantity. Refresh this receipt.',
          );
        // Cumulative rounding guarantees partial refunds sum exactly to the original line.
        const amount = (v: string) => {
          const cents = toScaled(v, 2);
          return (cents * after + sold / 2n) / sold - (cents * before + sold / 2n) / sold;
        };
        const value = amount(line.total),
          taxValue = amount(line.tax);
        total += value;
        tax += taxValue;
        const product = (
          await c.query('SELECT stock FROM products WHERE id=$1 AND store_id=$2 FOR UPDATE', [
            entry.productId,
            a.storeId,
          ])
        ).rows[0];
        if (!product) throw new NotFoundException('Product not found.');
        const balance =
          (nextBalances.get(entry.productId) ?? toScaled(product.stock, 3)) +
          (entry.restock ? qty : 0n);
        nextBalances.set(entry.productId, balance);
        lines.push({
          ...entry,
          name: line.name,
          sku: line.sku,
          unit: line.unit,
          total: fromScaled(value, 2),
          tax: fromScaled(taxValue, 2),
          balance: fromScaled(balance, 3),
        });
      }
      if (b.method === 'cash') {
        const cash = (
          await c.query(
            'SELECT COALESCE(sum(amount),0)::text AS amount FROM cash_movements WHERE shift_id=$1',
            [shift.id],
          )
        ).rows[0];
        if (toScaled(cash.amount, 2) < total)
          throw new BadRequestException(
            'Not enough recorded cash in this drawer. Ask a manager to add cash first.',
          );
      }
      const number =
        'RF-' +
        (await c.query("SELECT nextval('refund_number_sequence')::text AS n")).rows[0].n.padStart(
          6,
          '0',
        );
      const id = randomUUID();
      const receipt = {
        id,
        number,
        originalReceipt: original.receiptNumber,
        saleId: b.saleId,
        shiftId: shift.id,
        createdAt: new Date().toISOString(),
        cashier: a.name,
        approver: approver.name,
        device: a.deviceName,
        storeName: a.storeName,
        currency: a.currency,
        timezone: a.timezone,
        reason: b.reason,
        method: b.method,
        total: fromScaled(total, 2),
        tax: fromScaled(tax, 2),
        lines: lines.map(({ balance, ...l }) => l),
      };
      await c.query(
        'INSERT INTO refunds(id,store_id,sale_id,shift_id,employee_id,device_id,approver_id,request_id,request_hash,number,method,reason,total,tax,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
        [
          id,
          a.storeId,
          b.saleId,
          shift.id,
          a.employeeId,
          a.deviceId,
          approver.id,
          b.requestId,
          digest,
          number,
          b.method,
          b.reason,
          receipt.total,
          receipt.tax,
          receipt,
        ],
      );
      for (const l of lines) {
        const refundLineId = randomUUID();
        const restoredCost = await restockSaleBatches(
          c,
          a.storeId,
          b.saleId,
          l.productId,
          refundLineId,
          l.quantity,
          l.restock,
          l.saleItemId,
        );
        await c.query(
          'INSERT INTO refund_lines(id,store_id,refund_id,sale_id,product_id,quantity,restock,total,tax,restored_cost,sale_item_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            refundLineId,
            a.storeId,
            id,
            b.saleId,
            l.productId,
            l.quantity,
            l.restock,
            l.total,
            l.tax,
            restoredCost,
            l.saleItemId ?? null,
          ],
        );
        if (l.restock) {
          await c.query('UPDATE products SET stock=$2 WHERE id=$1', [l.productId, l.balance]);
          await c.query(
            "INSERT INTO movements(store_id,product_id,employee_id,device_id,quantity,balance,reason,notes,request_id,request_hash,sale_id,shift_id,refund_id) VALUES($1,$2,$3,$4,$5,$6,'sale_return',$7,$8,$9,$10,$11,$12)",
            [
              a.storeId,
              l.productId,
              a.employeeId,
              a.deviceId,
              l.quantity,
              l.balance,
              b.reason,
              randomUUID(),
              digest,
              b.saleId,
              shift.id,
              id,
            ],
          );
        }
      }
      if (b.method === 'cash')
        await c.query(
          "INSERT INTO cash_movements(store_id,shift_id,employee_id,device_id,amount,kind,reason,request_id,request_hash,refund_id) VALUES($1,$2,$3,$4,$5,'refund',$6,$7,$8,$9)",
          [
            a.storeId,
            shift.id,
            a.employeeId,
            a.deviceId,
            fromScaled(-total, 2),
            b.reason,
            randomUUID(),
            digest,
            id,
          ],
        );
      await audit(c, a, 'Refund completed', id, {
        saleId: b.saleId,
        shiftId: shift.id,
        total: receipt.total,
        approverId: approver.id,
        reason: b.reason,
      });
      return receipt;
    });
  }
}
@Module({
  imports: [AuthModule, RegisterModule],
  controllers: [ReceiptSearchController, RefundController],
})
export class RefundModule {}
