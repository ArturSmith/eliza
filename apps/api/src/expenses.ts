import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Req,
  Query,
  Param,
  Module,
  UseGuards,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { z } from 'zod';
import { expenseSchema } from '@eliza/contracts';
import { Database } from './database.js';
import { AuthModule } from './auth.js';
import { AccessGuard, Require, parse, type AuthRequest } from './security.js';
import { Operations, audit } from './operations.js';
const columns = `id,expense_date::text AS date,description,category,amount::text,payment_method AS "paymentMethod",payee,reference,notes,version,created_at AS "createdAt"`;
@Controller('expenses')
@UseGuards(AccessGuard)
class ExpensesController {
  constructor(
    private database: Database,
    private operations: Operations,
  ) {}
  @Get() @Require('expenses.read') async list(@Query() input: unknown, @Req() req: AuthRequest) {
    const q = parse(
      z
        .object({
          from: z.iso.date().optional(),
          to: z.iso.date().optional(),
          search: z.string().trim().max(200).default(''),
          page: z.coerce.number().int().min(1).max(100000).default(1),
        })
        .refine((q) => !q.from || !q.to || q.from <= q.to, 'Start date must be before end date'),
      input,
    );
    const args = [req.context.store.id, q.from ?? null, q.to ?? null, q.search];
    const where = `store_id=$1 AND ($2::date IS NULL OR expense_date>=$2) AND ($3::date IS NULL OR expense_date<=$3) AND ($4='' OR strpos(lower(description || ' ' || category || ' ' || payee || ' ' || reference),lower($4))>0)`;
    const summary = (
      await this.database.pool.query(
        `SELECT count(*)::int AS count,COALESCE(sum(amount),0)::text AS total FROM expenses WHERE ${where}`,
        args,
      )
    ).rows[0];
    const rows = (
      await this.database.pool.query(
        `SELECT ${columns} FROM expenses WHERE ${where} ORDER BY expense_date DESC,created_at DESC,id LIMIT 50 OFFSET $5`,
        [...args, (q.page - 1) * 50],
      )
    ).rows;
    return { rows, ...summary };
  }
  @Post() @Require('expenses.manage') create(@Body() input: unknown, @Req() req: AuthRequest) {
    const b = parse(expenseSchema, input);
    return this.operations.transaction(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO expenses(store_id,expense_date,description,category,amount,payment_method,payee,reference,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${columns}`,
          [
            req.context.store.id,
            b.date,
            b.description,
            b.category,
            b.amount,
            b.paymentMethod,
            b.payee,
            b.reference,
            b.notes,
          ],
        )
      ).rows[0];
      await audit(
        c,
        {
          storeId: req.context.store.id,
          employeeId: req.context.user.id,
          deviceId: req.context.device.id,
        },
        'Expense created',
        row.id,
        { after: row },
      );
      return row;
    });
  }
  @Patch(':id') @Require('expenses.manage') update(
    @Param('id') rawId: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const id = parse(z.uuid(), rawId),
      b = parse(expenseSchema.extend({ version: z.number().int().positive() }), input);
    return this.operations.transaction(async (c) => {
      const old = (
        await c.query(`SELECT ${columns} FROM expenses WHERE id=$1 AND store_id=$2 FOR UPDATE`, [
          id,
          req.context.store.id,
        ])
      ).rows[0];
      if (!old) throw new NotFoundException('Expense not found.');
      if (old.version !== b.version)
        throw new ConflictException('Expense changed. Reload before editing.');
      const row = (
        await c.query(
          `UPDATE expenses SET expense_date=$3,description=$4,category=$5,amount=$6,payment_method=$7,payee=$8,reference=$9,notes=$10,version=version+1,updated_at=now() WHERE id=$1 AND store_id=$2 RETURNING ${columns}`,
          [
            id,
            req.context.store.id,
            b.date,
            b.description,
            b.category,
            b.amount,
            b.paymentMethod,
            b.payee,
            b.reference,
            b.notes,
          ],
        )
      ).rows[0];
      await audit(
        c,
        {
          storeId: req.context.store.id,
          employeeId: req.context.user.id,
          deviceId: req.context.device.id,
        },
        'Expense updated',
        id,
        { before: old, after: row },
      );
      return row;
    });
  }
  @Delete(':id') @Require('expenses.manage') remove(
    @Param('id') rawId: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const id = parse(z.uuid(), rawId),
      b = parse(z.object({ version: z.number().int().positive() }), input);
    return this.operations.transaction(async (c) => {
      const old = (
        await c.query(`SELECT ${columns} FROM expenses WHERE id=$1 AND store_id=$2 FOR UPDATE`, [
          id,
          req.context.store.id,
        ])
      ).rows[0];
      if (!old) throw new NotFoundException('Expense not found.');
      if (old.version !== b.version)
        throw new ConflictException('Expense changed. Reload before deleting.');
      await c.query('DELETE FROM expenses WHERE id=$1 AND store_id=$2', [id, req.context.store.id]);
      await audit(
        c,
        {
          storeId: req.context.store.id,
          employeeId: req.context.user.id,
          deviceId: req.context.device.id,
        },
        'Expense deleted',
        id,
        { before: old },
      );
      return { id };
    });
  }
}
@Module({ imports: [AuthModule], controllers: [ExpensesController], providers: [Operations] })
export class ExpensesModule {}
