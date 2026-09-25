import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { employeeSchema, pinSchema } from '@eliza/contracts';
import { AuthModule } from './auth.js';
import { Database } from './database.js';
import { AccessGuard, type AuthRequest, Require, parse, passwordHash, token } from './security.js';
import { Operations, audit } from './operations.js';
@Controller('team')
@UseGuards(AccessGuard)
export class TeamController {
  constructor(
    private database: Database,
    private operations: Operations,
  ) {}
  @Get('roles') @Require('team.manage') async roles(@Req() req: AuthRequest) {
    return (
      await this.database.pool.query(
        'SELECT id,name,permissions FROM roles WHERE store_id=$1 ORDER BY name',
        [req.context.store.id],
      )
    ).rows;
  }
  @Post() @Require('team.manage') async create(@Body() input: unknown, @Req() req: AuthRequest) {
    const body = parse(employeeSchema, input);
    if ((body.email && !body.password) || (!body.email && body.password))
      throw new BadRequestException(
        'Provide both email and password for management login, or leave both blank for PIN-only access.',
      );
    const pin = await passwordHash(body.pin),
      password = await passwordHash(body.password || token());
    const { user, store, device } = req.context;
    return this.operations.transaction(async (client) => {
      const role = (
        await client.query('SELECT id FROM roles WHERE id=$1 AND store_id=$2', [
          body.roleId,
          store.id,
        ])
      ).rows[0];
      if (!role) throw new BadRequestException('Choose a role from this store.');
      const employee = (
        await client.query(
          'INSERT INTO employees(store_id,role_id,name,email,password_hash,employee_code,pin_hash,price_tags_access) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
          [
            store.id,
            body.roleId,
            body.name,
            body.email ? body.email.toLowerCase() : null,
            password,
            body.employeeCode,
            pin,
            body.priceTagsAccess,
          ],
        )
      ).rows[0];
      await audit(
        client,
        { storeId: store.id, employeeId: user.id, deviceId: device.id },
        'Employee created',
        employee.id,
        { name: body.name, employeeCode: body.employeeCode, roleId: body.roleId },
      );
      return employee;
    });
  }
  @Patch(':id') @Require('team.manage') async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(120),
        employeeCode: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9-]{1,20}$/)
          .transform((v) => v.toUpperCase()),
        roleId: z.uuid(),
        active: z.boolean(),
        priceTagsAccess: z.boolean().optional(),
        pin: z.union([pinSchema, z.literal('')]).default(''),
      }),
      input,
    );
    const pin = body.pin ? await passwordHash(body.pin) : null;
    const { user, store, device } = req.context;
    return this.operations.transaction(async (client) => {
      const old = (
        await client.query('SELECT * FROM employees WHERE id=$1 AND store_id=$2 FOR UPDATE', [
          id,
          store.id,
        ])
      ).rows[0];
      if (!old) throw new NotFoundException('Employee not found.');
      if (id === user.id && (!body.active || body.roleId !== old.role_id))
        throw new BadRequestException(
          'You cannot disable your own account or change your own role.',
        );
      if (
        !(
          await client.query('SELECT id FROM roles WHERE id=$1 AND store_id=$2', [
            body.roleId,
            store.id,
          ])
        ).rowCount
      )
        throw new BadRequestException('Choose a role from this store.');
      if (
        !body.active &&
        (await client.query("SELECT id FROM shifts WHERE employee_id=$1 AND status='open'", [id]))
          .rowCount
      )
        throw new BadRequestException(
          'Close this employee’s open shift before disabling their account.',
        );
      await client.query(
        'UPDATE employees SET name=$1,employee_code=$2,role_id=$3,active=$4,pin_hash=COALESCE($5,pin_hash),price_tags_access=$7 WHERE id=$6',
        [
          body.name,
          body.employeeCode,
          body.roleId,
          body.active,
          pin,
          id,
          body.priceTagsAccess ?? old.price_tags_access,
        ],
      );
      if (pin || !body.active || old.role_id !== body.roleId)
        await client.query('DELETE FROM pos_sessions WHERE employee_id=$1', [id]);
      if (pin || !body.active || body.priceTagsAccess === false)
        await client.query('DELETE FROM price_tag_sessions WHERE employee_id=$1', [id]);
      await audit(
        client,
        { storeId: store.id, employeeId: user.id, deviceId: device.id },
        'Employee updated',
        id,
        {
          before: {
            name: old.name,
            employeeCode: old.employee_code,
            roleId: old.role_id,
            active: old.active,
          },
          after: {
            name: body.name,
            employeeCode: body.employeeCode,
            roleId: body.roleId,
            active: body.active,
          },
          pinReset: !!pin,
        },
      );
      return { ok: true };
    });
  }
}
@Module({ imports: [AuthModule], controllers: [TeamController], providers: [Operations] })
export class TeamModule {}
