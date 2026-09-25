import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Database } from './database.js';
import { AccessGuard, type AuthRequest, parse, Require } from './security.js';
import { AuthModule } from './auth.js';
import { audits, devices, employees, roles } from './schema.js';
@Controller()
@UseGuards(AccessGuard)
export class ManagementController {
  constructor(private database: Database) {}
  @Get('audit') @Require('audit.read') async audit(@Req() req: AuthRequest) {
    return this.database.db
      .select({
        id: audits.id,
        action: audits.action,
        entityId: audits.entityId,
        actor: employees.name,
        device: devices.name,
        details: audits.details,
        createdAt: audits.createdAt,
      })
      .from(audits)
      .innerJoin(employees, eq(audits.employeeId, employees.id))
      .innerJoin(devices, eq(audits.deviceId, devices.id))
      .where(eq(audits.storeId, req.context.store.id))
      .orderBy(desc(audits.createdAt))
      .limit(100);
  }
  @Get('employees') @Require('team.read') async team(@Req() req: AuthRequest) {
    return this.database.db
      .select({
        id: employees.id,
        name: employees.name,
        email: sql<string>`COALESCE(${employees.email},'')`,
        roleId: employees.roleId,
        employeeCode: employees.employeeCode,
        hasPin: sql<boolean>`${employees.pinHash} IS NOT NULL`,
        roleIds: sql<
          string[]
        >`ARRAY(SELECT er.role_id::text FROM employee_roles er WHERE er.employee_id=${employees.id} ORDER BY CASE WHEN er.role_id=${employees.roleId} THEN 0 ELSE 1 END,er.role_id)`,
        roles: sql<
          string[]
        >`ARRAY(SELECT r2.name FROM employee_roles er JOIN roles r2 ON r2.id=er.role_id WHERE er.employee_id=${employees.id} ORDER BY CASE WHEN er.role_id=${employees.roleId} THEN 0 ELSE 1 END,r2.name)`,
        role: roles.name,
        active: employees.active,
        createdAt: employees.createdAt,
      })
      .from(employees)
      .innerJoin(roles, eq(employees.roleId, roles.id))
      .where(eq(employees.storeId, req.context.store.id));
  }
  @Get('devices') @Require('devices.manage') async list(@Req() req: AuthRequest) {
    return this.database.db
      .select({
        id: devices.id,
        name: devices.name,
        type: devices.type,
        active: devices.active,
        createdAt: devices.createdAt,
      })
      .from(devices)
      .where(eq(devices.storeId, req.context.store.id));
  }
  @Patch('devices/:id') @Require('devices.manage') async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(120),
        active: z.boolean(),
        type: z.enum(['management', 'pos', 'price_tags']).optional(),
      }),
      input,
    );
    const { store, user, device } = req.context;
    const result = await this.database.db.transaction(async (tx) => {
      const [old] = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.id, id), eq(devices.storeId, store.id)))
        .for('update');
      if (!old) throw new NotFoundException('Device not found.');
      const type = body.type ?? old.type;
      if (old.type === 'pos' && type !== 'pos') {
        const open = await tx.execute(
          sql`SELECT id FROM shifts WHERE device_id=${id} AND status='open' LIMIT 1`,
        );
        if (open.rowCount)
          throw new BadRequestException(
            'Close the open cashier shift before changing this device.',
          );
      }
      await tx
        .update(devices)
        .set({ ...body, type })
        .where(eq(devices.id, id));
      if (old.type !== type || !body.active) {
        await tx.execute(sql`DELETE FROM sessions WHERE device_id=${id}`);
        await tx.execute(sql`DELETE FROM pos_sessions WHERE device_id=${id}`);
        await tx.execute(sql`DELETE FROM price_tag_sessions WHERE device_id=${id}`);
      }
      await tx.insert(audits).values({
        storeId: store.id,
        employeeId: user.id,
        deviceId: device.id,
        action: 'Device updated',
        entityId: id,
        details: {
          before: { name: old.name, active: old.active, type: old.type },
          after: { ...body, type },
        },
      });
      return { ok: true };
    });
    if (id === device.id && body.type && body.type !== device.type)
      res.clearCookie('eliza_register', { path: '/api' });
    return result;
  }
}
@Module({ imports: [AuthModule], controllers: [ManagementController] })
export class ManagementModule {}
