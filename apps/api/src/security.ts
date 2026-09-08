import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import type { Request } from 'express';
import type { Permission, Session } from '@eliza/contracts';
import { Database } from './database.js';
import { sessions, employees, devices, stores, roles } from './schema.js';
const scrypt = promisify(scryptCallback);
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('hex');
export async function passwordHash(value: string) {
  const salt = randomBytes(16).toString('hex');
  const key = (await scrypt(value, salt, 64)) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(value: string, stored: string) {
  const [salt, key] = stored.split(':');
  const actual = (await scrypt(value, salt, 64)) as Buffer;
  const expected = Buffer.from(key, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function cookie(req: Request, name: string) {
  const raw = req.headers.cookie?.split(';').find((v) => v.trim().startsWith(`${name}=`));
  return raw?.trim().slice(name.length + 1) ?? '';
}
export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new BadRequestException(
      result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  return result.data;
}
export const Require = (permission: Permission) => SetMetadata('permission', permission);
export type AuthRequest = Request & { context: Session };
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private database: Database,
    private reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const [row] = await this.database.db
      .select({ user: employees, device: devices, store: stores, role: roles })
      .from(sessions)
      .innerJoin(employees, eq(sessions.employeeId, employees.id))
      .innerJoin(devices, eq(sessions.deviceId, devices.id))
      .innerJoin(stores, eq(employees.storeId, stores.id))
      .innerJoin(roles, eq(employees.roleId, roles.id))
      .where(
        and(
          eq(sessions.tokenHash, hash(cookie(req, 'eliza_session'))),
          gt(sessions.expiresAt, new Date()),
          eq(employees.active, true),
          eq(devices.active, true),
        ),
      );
    if (!row || row.device.storeId !== row.store.id || row.role.storeId !== row.store.id)
      throw new UnauthorizedException('Please sign in to continue.');
    const permission = this.reflector.getAllAndOverride<Permission>('permission', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (permission && !row.role.permissions.includes(permission))
      throw new ForbiddenException("You don't have permission to perform this action.");
    req.context = {
      user: {
        id: row.user.id,
        name: row.user.name,
        email: row.user.email,
        role: row.role.name,
        permissions: row.role.permissions as Permission[],
      },
      store: {
        id: row.store.id,
        name: row.store.name,
        currency: row.store.currency,
        timezone: row.store.timezone,
      },
      device: { id: row.device.id, name: row.device.name },
    };
    return true;
  }
}
