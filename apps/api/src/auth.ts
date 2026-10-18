import { readOnboarding, saveOnboarding } from './onboarding.js';
import {
  Body,
  ConflictException,
  ForbiddenException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Injectable,
  Module,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { loginSchema, permissions, setupSchema, cashierPermissions } from '@eliza/contracts';
import { Database } from './database.js';
import { setupAuthorized } from './production.js';
import {
  AccessGuard,
  type AuthRequest,
  cookie,
  hash,
  parse,
  passwordHash,
  token,
  verifyPassword,
} from './security.js';
import { audits, devices, employees, organizations, roles, sessions, stores } from './schema.js';
@Injectable()
export class AuthService {
  constructor(private database: Database) {}
  async limit(ip: string) {
    await this.database.pool.query('DELETE FROM auth_attempts WHERE expires_at < now()');
    const result = await this.database.pool.query(
      `INSERT INTO auth_attempts(key,count,expires_at) VALUES($1,1,now()+interval '10 minutes')
       ON CONFLICT(key) DO UPDATE SET
         count=CASE WHEN auth_attempts.expires_at < now() THEN 1 ELSE auth_attempts.count+1 END,
         expires_at=CASE WHEN auth_attempts.expires_at < now() THEN now()+interval '10 minutes' ELSE auth_attempts.expires_at END
       RETURNING count`,
      [hash(ip)],
    );
    if (result.rows[0].count > 20)
      throw new HttpException('Too many attempts. Try again in ten minutes.', 429);
  }
  async setup(input: unknown) {
    const body = parse(setupSchema, input);
    const encoded = await passwordHash(body.password);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(734101)`);
      if ((await tx.select().from(organizations).limit(1)).length)
        throw new ConflictException('This application has already been set up. Please sign in.');
      const [org] = await tx.insert(organizations).values({ name: body.storeName }).returning();
      const [store] = await tx
        .insert(stores)
        .values({
          organizationId: org.id,
          name: body.storeName,
          currency: body.currency,
          timezone: body.timezone,
        })
        .returning();
      const [ownerRole] = await tx
        .insert(roles)
        .values({ storeId: store.id, name: 'Owner', permissions: [...permissions] })
        .returning();
      const [generalRole] = await tx
        .insert(roles)
        .values({ storeId: store.id, name: 'General employee', permissions: [] })
        .returning();
      await tx.insert(roles).values([
        {
          storeId: store.id,
          name: 'Manager',
          permissions: permissions.filter((p) => !['settings.manage', 'team.manage'].includes(p)),
        },
        { storeId: store.id, name: 'Cashier', permissions: cashierPermissions },
      ]);
      const [owner] = await tx
        .insert(employees)
        .values({
          storeId: store.id,
          roleId: ownerRole.id,
          name: body.ownerName,
          employeeCode: 'OWNER',
          email: body.email,
          passwordHash: encoded,
        })
        .returning();
      await tx.execute(
        sql`INSERT INTO employee_roles(employee_id,role_id,store_id) VALUES(${owner.id},${ownerRole.id},${store.id}),(${owner.id},${generalRole.id},${store.id})`,
      );
      return { id: owner.id, storeId: store.id };
    });
  }
  async login(input: unknown) {
    const body = parse(loginSchema, input);
    const [user] = await this.database.db
      .select()
      .from(employees)
      .where(eq(employees.email, body.email));
    const valid = await verifyPassword(
      body.password,
      user?.passwordHash ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`,
    );
    if (!user || !user.active || !valid)
      throw new UnauthorizedException('Email or password is incorrect.');
    return user;
  }
  async issue(user: { id: string; storeId: string }, req: Request, res: Response) {
    const secret = token();
    const newDeviceToken = token();
    const device = await this.database.db.transaction(async (tx) => {
      const registerToken = cookie(req, 'eliza_register');
      const registerDevice = registerToken
        ? await tx
            .select()
            .from(devices)
            .where(
              and(
                eq(devices.tokenHash, hash(registerToken)),
                eq(devices.storeId, user.storeId),
                sql`${devices.removedAt} IS NULL`,
              ),
            )
        : [];
      const [existing] = registerDevice.length
        ? registerDevice
        : await tx
            .select()
            .from(devices)
            .where(
              and(
                eq(devices.tokenHash, hash(cookie(req, 'eliza_device'))),
                eq(devices.storeId, user.storeId),
                sql`${devices.removedAt} IS NULL`,
              ),
            );
      if (existing && !existing.active)
        throw new UnauthorizedException('This device has been blocked. Contact the store owner.');
      if (existing && existing.type !== 'management')
        throw new UnauthorizedException(
          'This device is assigned to another workspace. Ask a manager to change it in Devices.',
        );
      const device =
        existing ??
        (
          await tx
            .insert(devices)
            .values({
              storeId: user.storeId,
              name: 'Management browser',
              type: 'management',
              tokenHash: hash(newDeviceToken),
            })
            .returning()
        )[0];
      if (!existing)
        await tx.insert(audits).values({
          storeId: user.storeId,
          employeeId: user.id,
          deviceId: device.id,
          action: 'Device registered',
          entityId: device.id,
          details: { name: device.name, type: device.type },
        });
      await tx.insert(sessions).values({
        tokenHash: hash(secret),
        employeeId: user.id,
        deviceId: device.id,
        expiresAt: new Date(Date.now() + 12 * 3600_000),
      });
      return { device, isNew: !existing };
    });
    const options = {
      httpOnly: true,
      sameSite: 'strict' as const,
      secure: process.env.NODE_ENV === 'production' && process.env.ELIZA_DESKTOP !== 'true',
      path: '/api',
    };
    res.cookie('eliza_session', secret, { ...options, maxAge: 12 * 3600_000 });
    if (device.isNew)
      res.cookie('eliza_device', newDeviceToken, { ...options, maxAge: 365 * 86400_000 });
    else if (!cookie(req, 'eliza_device') && cookie(req, 'eliza_register'))
      res.cookie('eliza_device', cookie(req, 'eliza_register'), {
        ...options,
        maxAge: 365 * 86400_000,
      });
    return { ok: true };
  }
}
@Controller('auth')
export class AuthController {
  constructor(
    private database: Database,
    private auth: AuthService,
  ) {}
  @Get('device-environment') async environment(@Req() req: Request) {
    const registerToken = cookie(req, 'eliza_register');
    const managementToken = cookie(req, 'eliza_device');
    const hashes = [registerToken, managementToken].filter(Boolean).map(hash);
    if (!hashes.length) return { type: 'management' };
    const result = await this.database.pool.query(
      'SELECT type FROM devices WHERE removed_at IS NULL AND token_hash=ANY($1::text[]) ORDER BY CASE WHEN token_hash=$2 THEN 0 ELSE 1 END LIMIT 1',
      [hashes, hash(registerToken)],
    );
    return { type: result.rows[0]?.type ?? 'management' };
  }
  @Get('status') async status() {
    return {
      needsSetup:
        (await this.database.db.select({ id: organizations.id }).from(organizations).limit(1))
          .length === 0,
    };
  }
  @Post('setup') async setup(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.limit(req.ip ?? 'local');
    if (!setupAuthorized(req.headers['x-eliza-setup-token']))
      throw new ForbiddenException(
        'A valid setup token is required. Contact the deployment administrator.',
      );
    const user = await this.auth.setup(body);
    return this.auth.issue(user, req, res);
  }
  @Post('login') @HttpCode(200) async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.limit(req.ip ?? 'local');
    return this.auth.issue(await this.auth.login(body), req, res);
  }
  @Post('reclaim-device') @HttpCode(200) async reclaimDevice(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.limit(req.ip ?? 'local');
    const user = await this.auth.login(body);
    const registerToken = cookie(req, 'eliza_register');
    const managementToken = cookie(req, 'eliza_device');
    let deviceToken = registerToken || managementToken;
    if (!deviceToken) throw new UnauthorizedException('This browser is not an enrolled device.');
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const device = (
        await client.query(
          'SELECT id,store_id,type,active,token_hash FROM devices WHERE token_hash=$1 OR token_hash=$2 ORDER BY CASE WHEN token_hash=$1 THEN 0 ELSE 1 END LIMIT 1 FOR UPDATE',
          [hash(registerToken), hash(managementToken)],
        )
      ).rows[0];
      if (device?.token_hash === hash(managementToken)) deviceToken = managementToken;
      if (!device || device.store_id !== user.storeId || !device.active)
        throw new UnauthorizedException('This device cannot be switched to Management.');
      const role = (
        await client.query(
          "SELECT (SELECT COALESCE(jsonb_agg(DISTINCT p.value),'[]'::jsonb) FROM employee_roles er JOIN roles rr ON rr.id=er.role_id AND rr.store_id=er.store_id CROSS JOIN LATERAL jsonb_array_elements_text(rr.permissions) p(value) WHERE er.employee_id=e.id AND er.store_id=e.store_id) AS permissions FROM employees e JOIN roles r ON r.id=e.role_id AND r.store_id=e.store_id WHERE e.id=$1 AND e.store_id=$2 AND e.active",
          [user.id, user.storeId],
        )
      ).rows[0];
      if (!role?.permissions.includes('devices.manage'))
        throw new ForbiddenException('Only a manager can change this device environment.');
      if (
        (
          await client.query("SELECT id FROM shifts WHERE device_id=$1 AND status='open' LIMIT 1", [
            device.id,
          ])
        ).rowCount
      )
        throw new ConflictException(
          'Close the open cashier shift before switching this device to Management.',
        );
      await client.query("UPDATE devices SET type='management' WHERE id=$1", [device.id]);
      await client.query('DELETE FROM sessions WHERE device_id=$1', [device.id]);
      await client.query('DELETE FROM pos_sessions WHERE device_id=$1', [device.id]);
      await client.query('DELETE FROM price_tag_sessions WHERE device_id=$1', [device.id]);
      await client.query(
        "INSERT INTO audits(store_id,employee_id,device_id,action,entity_id,details) VALUES($1,$2,$3,'Device environment changed',$3,$4)",
        [user.storeId, user.id, device.id, JSON.stringify({ from: device.type, to: 'management' })],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    const result = await this.auth.issue(user, req, res);
    res.cookie('eliza_device', deviceToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production' && process.env.ELIZA_DESKTOP !== 'true',
      path: '/api',
      maxAge: 365 * 86400_000,
    });
    res.clearCookie('eliza_register', { path: '/api' });
    res.clearCookie('eliza_pos_session', { path: '/api' });
    res.clearCookie('eliza_price_tags_session', { path: '/api' });
    return result;
  }
  @Get('onboarding') @UseGuards(AccessGuard) onboarding(@Req() req: AuthRequest) {
    return readOnboarding(this.database.pool, {
      storeId: req.context.store.id,
      employeeId: req.context.user.id,
    });
  }
  @Post('onboarding') @UseGuards(AccessGuard) saveOnboarding(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return saveOnboarding(
      this.database.pool,
      { storeId: req.context.store.id, employeeId: req.context.user.id },
      body,
    );
  }
  @Get('session') @UseGuards(AccessGuard) session(@Req() req: AuthRequest) {
    return req.context;
  }
  @Post('logout') @HttpCode(200) async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.database.db
      .delete(sessions)
      .where(eq(sessions.tokenHash, hash(cookie(req, 'eliza_session'))));
    res.clearCookie('eliza_session', { path: '/api' });
    return { ok: true };
  }
}
@Module({
  controllers: [AuthController],
  providers: [AuthService, AccessGuard],
  exports: [AccessGuard],
})
export class AuthModule {}
