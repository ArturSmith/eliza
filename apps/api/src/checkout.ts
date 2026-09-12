import {
  Body,
  Controller,
  Get,
  HttpException,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  startShiftSchema,
  closeShiftSchema,
  cashSchema,
  saleSchema,
  calculateLine,
  toScaled,
  fromScaled,
  type Receipt,
} from '@eliza/contracts';
import { RegisterModule, RegisterService, shiftRow, type Operator } from './register.js';
import { Operations, audit } from './operations.js';
import { AccessGuard, type AuthRequest, Require, parse, hash } from './security.js';
import { AuthModule } from './auth.js';
import { Database } from './database.js';
async function requestLock(client: PoolClient, storeId: string, id: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [storeId + id]);
}
function fingerprint(body: unknown, actor: Operator) {
  return hash(JSON.stringify({ body, employeeId: actor.employeeId, deviceId: actor.deviceId }));
}
function same(existing: { request_hash: string }, value: string) {
  if (existing.request_hash !== value)
    throw new ConflictException('This request was already used for a different operation.');
}
async function openShift(client: PoolClient, actor: Operator, id?: string) {
  const shift = (
    await client.query(
      "SELECT * FROM shifts WHERE device_id=$1 AND employee_id=$2 AND store_id=$3 AND status='open' FOR UPDATE",
      [actor.deviceId, actor.employeeId, actor.storeId],
    )
  ).rows[0];
  if (!shift || (id && shift.id !== id))
    throw new ConflictException('Start your shift before using this register.');
  return shift;
}
@Controller('pos')
export class CheckoutController {
  constructor(
    private operations: Operations,
    private registers: RegisterService,
  ) {}
  @Get('products') products(@Req() req: Request) {
    return this.operations.transaction(async (client) => {
      const actor = await this.registers.operator(client, req);
      return (
        await client.query(
          `SELECT p.id,p.image,p.source,p.name,p.sku,p.category,p.unit,p.price,p.tax_rate AS "taxRate",p.stock,COALESCE(p.plu,'') AS plu,COALESCE((SELECT jsonb_agg(b.value ORDER BY b.value) FROM barcodes b WHERE b.product_id=p.id),'[]'::jsonb) AS barcodes FROM products p WHERE p.store_id=$1 AND p.active ORDER BY p.name`,
          [actor.storeId],
        )
      ).rows;
    });
  }
  @Post('shifts') start(@Body() input: unknown, @Req() req: Request) {
    const body = parse(startShiftSchema, input);
    return this.operations.transaction(async (client) => {
      const actor = await this.registers.operator(client, req);
      await requestLock(client, actor.storeId, body.requestId);
      const digest = fingerprint(body, actor);
      const existing = (
        await client.query('SELECT * FROM shifts WHERE store_id=$1 AND request_id=$2', [
          actor.storeId,
          body.requestId,
        ])
      ).rows[0];
      if (existing) {
        same(existing, digest);
        return shiftRow(client, existing.id);
      }
      // One employee cannot open concurrent shifts on different registers.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        actor.employeeId,
      ]);
      if (
        (
          await client.query(
            "SELECT id FROM shifts WHERE (device_id=$1 OR employee_id=$2) AND status='open'",
            [actor.deviceId, actor.employeeId],
          )
        ).rowCount
      )
        throw new ConflictException('This register or employee already has an open shift.');
      const shift = (
        await client.query(
          'INSERT INTO shifts(store_id,device_id,employee_id,opening_cash,request_id,request_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
          [
            actor.storeId,
            actor.deviceId,
            actor.employeeId,
            body.openingCash,
            body.requestId,
            digest,
          ],
        )
      ).rows[0];
      await client.query(
        "INSERT INTO cash_movements(store_id,shift_id,employee_id,device_id,amount,kind,reason,request_id,request_hash) VALUES($1,$2,$3,$4,$5,'opening','Opening float',$6,$7)",
        [
          actor.storeId,
          shift.id,
          actor.employeeId,
          actor.deviceId,
          body.openingCash,
          randomUUID(),
          digest,
        ],
      );
      await audit(client, actor, 'Shift opened', shift.id, { openingCash: body.openingCash });
      return shiftRow(client, shift.id);
    });
  }
  @Post('shifts/:id/close') close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    const body = parse(closeShiftSchema, input);
    return this.operations.transaction(async (client) => {
      const actor = await this.registers.operator(client, req);
      const { approval, ...payload } = body;
      const digest = fingerprint(payload, actor);
      const existing = (
        await client.query(
          'SELECT * FROM shifts WHERE id=$1 AND store_id=$2 AND device_id=$3 AND employee_id=$4 FOR UPDATE',
          [id, actor.storeId, actor.deviceId, actor.employeeId],
        )
      ).rows[0];
      if (!existing) throw new NotFoundException('Shift not found.');
      if (existing.status === 'closed') {
        if (existing.close_hash !== digest)
          throw new ConflictException('This shift is already closed.');
        return shiftRow(client, id);
      }
      const expected = (
        await client.query(
          'SELECT COALESCE(sum(amount),0)::numeric(14,2)::text AS total FROM cash_movements WHERE shift_id=$1',
          [id],
        )
      ).rows[0].total;
      const difference = toScaled(body.countedCash, 2) - toScaled(expected, 2);
      let approver = null;
      if (difference !== 0n && !actor.permissions.includes('shift.approve')) {
        if (!approval) throw new ForbiddenException('A manager must approve a cash difference.');
        const manager = await this.registers.checkPin(
          client,
          actor.deviceId,
          actor.storeId,
          approval,
          'shift.approve',
        );
        if (manager instanceof HttpException) return manager;
        approver = manager.id;
      }
      await client.query(
        "UPDATE shifts SET status='closed',expected_cash=$1,counted_cash=$2,difference=$3,closed_at=now(),notes=$4,close_request_id=$5,close_hash=$6,approver_id=$7 WHERE id=$8",
        [
          expected,
          body.countedCash,
          fromScaled(difference, 2),
          body.notes,
          body.requestId,
          digest,
          approver,
          id,
        ],
      );
      await audit(client, actor, 'Shift closed', id, {
        expectedCash: expected,
        countedCash: body.countedCash,
        difference: fromScaled(difference, 2),
        approverId: approver,
        notes: body.notes,
      });
      return shiftRow(client, id);
    });
  }
  @Post('cash') cash(@Body() input: unknown, @Req() req: Request) {
    const body = parse(cashSchema, input);
    return this.operations.transaction(async (client) => {
      const actor = await this.registers.operator(client, req);
      if (!actor.permissions.includes('cash.manage'))
        throw new ForbiddenException('A manager must record cash in or cash out.');
      await requestLock(client, actor.storeId, body.requestId);
      const digest = fingerprint(body, actor);
      const existing = (
        await client.query('SELECT * FROM cash_movements WHERE store_id=$1 AND request_id=$2', [
          actor.storeId,
          body.requestId,
        ])
      ).rows[0];
      if (existing) {
        same(existing, digest);
        return { id: existing.id };
      }
      const shift = await openShift(client, actor);
      const amount = toScaled(body.amount, 2) * (body.direction === 'out' ? -1n : 1n);
      const expected = (
        await client.query(
          'SELECT COALESCE(sum(amount),0)::numeric(14,2)::text AS total FROM cash_movements WHERE shift_id=$1',
          [shift.id],
        )
      ).rows[0].total;
      if (toScaled(expected, 2) + amount < 0n)
        throw new BadRequestException('Cash out exceeds the expected cash in the drawer.');
      const row = (
        await client.query(
          'INSERT INTO cash_movements(store_id,shift_id,employee_id,device_id,amount,kind,reason,request_id,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
          [
            actor.storeId,
            shift.id,
            actor.employeeId,
            actor.deviceId,
            fromScaled(amount, 2),
            body.direction,
            body.reason,
            body.requestId,
            digest,
          ],
        )
      ).rows[0];
      await audit(client, actor, 'Cash movement recorded', shift.id, {
        amount: fromScaled(amount, 2),
        reason: body.reason,
        movementId: row.id,
      });
      return row;
    });
  }
  @Post('sales') sale(@Body() input: unknown, @Req() req: Request) {
    const body = parse(saleSchema, input);
    return this.operations.transaction(async (client) => {
      const actor = await this.registers.operator(client, req);
      await requestLock(client, actor.storeId, body.requestId);
      const { approval, ...payload } = body;
      const digest = fingerprint(payload, actor);
      const existing = (
        await client.query(
          'SELECT request_hash,receipt FROM sales WHERE store_id=$1 AND request_id=$2',
          [actor.storeId, body.requestId],
        )
      ).rows[0];
      if (existing) {
        same(existing, digest);
        return existing.receipt;
      }
      const shift = await openShift(client, actor, body.shiftId);
      const products = (
        await client.query(
          'SELECT * FROM products WHERE store_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',
          [actor.storeId, body.lines.map((l) => l.productId)],
        )
      ).rows;
      const lines: Receipt['lines'] = [];
      let subtotal = 0n,
        discount = 0n,
        tax = 0n,
        total = 0n;
      for (const item of body.lines) {
        const product = products.find((p) => p.id === item.productId);
        if (!product || !product.active)
          throw new BadRequestException('A product is no longer available. Refresh your cart.');
        if (
          toScaled(product.price, 2) !== toScaled(item.expectedPrice, 2) ||
          toScaled(product.tax_rate, 2) !== toScaled(item.expectedTaxRate, 2)
        )
          throw new ConflictException(
            `${product.name} has a new price or tax rate. Refresh the catalog and rebuild the affected cart line.`,
          );
        const qty = toScaled(item.quantity, 3);
        if (['piece', 'pack', 'box'].includes(product.unit) && qty % 1000n !== 0n)
          throw new BadRequestException(`${product.name} requires a whole-number quantity.`);
        if (qty > toScaled(product.stock, 3))
          throw new ConflictException(`Not enough stock for ${product.name}.`);
        const amounts = calculateLine(
          product.price,
          item.quantity,
          product.tax_rate,
          body.discountPercent,
        );
        subtotal += toScaled(amounts.gross, 2);
        discount += toScaled(amounts.discount, 2);
        tax += toScaled(amounts.tax, 2);
        total += toScaled(amounts.total, 2);
        lines.push({
          productId: product.id,
          name: product.name,
          category: product.category,
          sku: product.sku,
          unit: product.unit,
          quantity: item.quantity,
          price: product.price,
          taxRate: product.tax_rate,
          ...amounts,
        });
      }
      if (total > 99999999999n) throw new BadRequestException('Sale exceeds the supported total.');
      const tendered = toScaled(body.payment.tendered, 2);
      if (tendered < total) throw new BadRequestException('Payment does not cover the sale total.');
      if (body.payment.method === 'card' && tendered !== total)
        throw new BadRequestException('The recorded card amount must equal the total.');
      let approverName: string | null = null,
        approverId: string | null = null;
      if (
        toScaled(body.discountPercent, 2) > 1000n &&
        !actor.permissions.includes('discount.approve')
      ) {
        if (!approval)
          throw new ForbiddenException('Discounts above 10% require manager approval.');
        const manager = await this.registers.checkPin(
          client,
          actor.deviceId,
          actor.storeId,
          approval,
          'discount.approve',
        );
        if (manager instanceof HttpException) return manager;
        approverName = manager.name;
        approverId = manager.id;
      }
      const receiptId = randomUUID();
      const sequence = (await client.query("SELECT nextval('receipt_sequence')::text AS n")).rows[0]
        .n;
      const profile = (
        await client.query(
          'SELECT name,address,phone,business_number,receipt_footer FROM stores WHERE id=$1',
          [actor.storeId],
        )
      ).rows[0];
      const receipt: Receipt = {
        id: receiptId,
        receiptNumber: `E-${sequence.padStart(7, '0')}`,
        createdAt: new Date().toISOString(),
        storeName: profile.name,
        storeAddress: profile.address,
        storePhone: profile.phone,
        businessNumber: profile.business_number,
        receiptFooter: profile.receipt_footer,
        currency: actor.currency,
        timezone: actor.timezone,
        cashierName: actor.name,
        deviceName: actor.deviceName,
        shiftId: shift.id,
        lines,
        subtotal: fromScaled(subtotal, 2),
        discount: fromScaled(discount, 2),
        tax: fromScaled(tax, 2),
        total: fromScaled(total, 2),
        discountPercent: body.discountPercent,
        payment: {
          method: body.payment.method,
          tendered: body.payment.tendered,
          change: fromScaled(tendered - total, 2),
        },
        approverName,
      };
      await client.query(
        'INSERT INTO sales(id,store_id,device_id,employee_id,shift_id,request_id,request_hash,receipt_number,total,tax,discount,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          receiptId,
          actor.storeId,
          actor.deviceId,
          actor.employeeId,
          shift.id,
          body.requestId,
          digest,
          receipt.receiptNumber,
          receipt.total,
          receipt.tax,
          receipt.discount,
          JSON.stringify(receipt),
        ],
      );
      for (const line of lines) {
        const product = products.find((p) => p.id === line.productId)!;
        const balance = fromScaled(toScaled(product.stock, 3) - toScaled(line.quantity, 3), 3);
        await client.query('UPDATE products SET stock=$1 WHERE id=$2', [balance, product.id]);
        await client.query(
          'INSERT INTO sale_items(store_id,sale_id,product_id,quantity,price,cost,tax_rate,total) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            actor.storeId,
            receiptId,
            product.id,
            line.quantity,
            line.price,
            product.cost,
            line.taxRate,
            line.total,
          ],
        );
        await client.query(
          "INSERT INTO movements(store_id,product_id,employee_id,device_id,quantity,balance,reason,notes,request_id,request_hash,sale_id,shift_id) VALUES($1,$2,$3,$4,$5,$6,'sale',$7,$8,$9,$10,$11)",
          [
            actor.storeId,
            product.id,
            actor.employeeId,
            actor.deviceId,
            fromScaled(-toScaled(line.quantity, 3), 3),
            balance,
            receipt.receiptNumber,
            randomUUID(),
            digest,
            receiptId,
            shift.id,
          ],
        );
      }
      await client.query(
        'INSERT INTO payments(store_id,sale_id,method,amount,tendered,change) VALUES($1,$2,$3,$4,$5,$6)',
        [
          actor.storeId,
          receiptId,
          body.payment.method,
          receipt.total,
          body.payment.tendered,
          receipt.payment.change,
        ],
      );
      if (body.payment.method === 'cash')
        await client.query(
          "INSERT INTO cash_movements(store_id,shift_id,employee_id,device_id,amount,kind,reason,request_id,request_hash,sale_id) VALUES($1,$2,$3,$4,$5,'sale',$6,$7,$8,$9)",
          [
            actor.storeId,
            shift.id,
            actor.employeeId,
            actor.deviceId,
            receipt.total,
            receipt.receiptNumber,
            randomUUID(),
            digest,
            receiptId,
          ],
        );
      await audit(client, actor, 'Sale completed', receiptId, {
        receiptNumber: receipt.receiptNumber,
        total: receipt.total,
        discount: receipt.discount,
        approverId,
        paymentMethod: body.payment.method,
        shiftId: shift.id,
      });
      return receipt;
    });
  }
  @Get('sales') recent(@Req() req: Request) {
    return this.operations.transaction(async (client) => {
      const actor = await this.registers.operator(client, req);
      return (
        await client.query(
          'SELECT receipt FROM sales WHERE store_id=$1 AND employee_id=$2 AND device_id=$3 ORDER BY created_at DESC LIMIT 20',
          [actor.storeId, actor.employeeId, actor.deviceId],
        )
      ).rows.map((r) => r.receipt);
    });
  }
  @Post('sales/:id/reprint') reprint(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.operations.transaction(async (client) => {
      const actor = await this.registers.operator(client, req);
      const sale = (
        await client.query(
          'SELECT receipt FROM sales WHERE id=$1 AND store_id=$2 AND employee_id=$3 AND device_id=$4',
          [id, actor.storeId, actor.employeeId, actor.deviceId],
        )
      ).rows[0];
      if (!sale) throw new NotFoundException('Receipt not found.');
      await audit(client, actor, 'Receipt reprinted', id, {});
      return sale.receipt;
    });
  }
}
@Controller('reports')
@UseGuards(AccessGuard)
export class SalesReportsController {
  constructor(
    private operations: Operations,
    private database: Database,
  ) {}
  @Get('sales') @Require('sales.read') async sales(@Req() req: AuthRequest) {
    return (
      await this.database.pool.query(
        'SELECT receipt FROM sales WHERE store_id=$1 ORDER BY created_at DESC LIMIT 100',
        [req.context.store.id],
      )
    ).rows.map((row) => row.receipt);
  }
  @Post('sales/:id/reprint') @Require('sales.read') reprint(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.operations.transaction(async (client) => {
      const receipt = (
        await client.query('SELECT receipt FROM sales WHERE id=$1 AND store_id=$2', [
          id,
          req.context.store.id,
        ])
      ).rows[0];
      if (!receipt) throw new NotFoundException('Receipt not found.');
      await audit(
        client,
        {
          storeId: req.context.store.id,
          employeeId: req.context.user.id,
          deviceId: req.context.device.id,
        },
        'Receipt reprinted',
        id,
        {},
      );
      return { ok: true };
    });
  }
  @Get('shifts') @Require('sales.read') shifts(@Req() req: AuthRequest) {
    return this.operations.transaction(async (client) => {
      const rows = (
        await client.query(
          'SELECT id FROM shifts WHERE store_id=$1 ORDER BY opened_at DESC LIMIT 100',
          [req.context.store.id],
        )
      ).rows;
      return Promise.all(rows.map((r) => shiftRow(client, r.id)));
    });
  }
  @Get('shifts/:id/cash') @Require('sales.read') async cash(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return (
      await this.database.pool.query(
        `SELECT c.id,c.amount,c.kind,c.reason,c.created_at AS "createdAt",e.name AS actor FROM cash_movements c JOIN employees e ON e.id=c.employee_id WHERE c.shift_id=$1 AND c.store_id=$2 ORDER BY c.created_at`,
        [id, req.context.store.id],
      )
    ).rows;
  }
}
@Module({
  imports: [RegisterModule, AuthModule],
  controllers: [CheckoutController, SalesReportsController],
})
export class CheckoutModule {}
