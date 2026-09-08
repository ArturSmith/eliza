import {
  Body,
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
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
  ) {
    const body = parse(
      z.object({ name: z.string().trim().min(1).max(120), active: z.boolean() }),
      input,
    );
    const { store, user, device } = req.context;
    return this.database.db.transaction(async (tx) => {
      const [old] = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.id, id), eq(devices.storeId, store.id)))
        .for('update');
      if (!old) throw new NotFoundException('Device not found.');
      await tx.update(devices).set(body).where(eq(devices.id, id));
      await tx.insert(audits).values({
        storeId: store.id,
        employeeId: user.id,
        deviceId: device.id,
        action: 'Device updated',
        entityId: id,
        details: { before: { name: old.name, active: old.active }, after: body },
      });
      return { ok: true };
    });
  }
}
@Module({ imports: [AuthModule], controllers: [ManagementController] })
export class ManagementModule {}
