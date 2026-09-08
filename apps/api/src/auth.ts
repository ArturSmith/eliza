import {
  Body,
  ConflictException,
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
import { loginSchema, permissions, setupSchema } from '@eliza/contracts';
import { Database } from './database.js';
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
  private attempts = new Map<string, { count: number; until: number }>();
  limit(ip: string) {
    const now = Date.now();
    for (const [key, value] of this.attempts) if (value.until < now) this.attempts.delete(key);
    const attempt = this.attempts.get(ip) ?? { count: 0, until: now + 600_000 };
    if (++attempt.count > 20)
      throw new HttpException('Too many attempts. Try again in ten minutes.', 429);
    this.attempts.set(ip, attempt);
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
      await tx.insert(roles).values([
        {
          storeId: store.id,
          name: 'Manager',
          permissions: permissions.filter((p) => p !== 'settings.manage'),
        },
        { storeId: store.id, name: 'Cashier', permissions: ['catalog.read'] },
      ]);
      const [owner] = await tx
        .insert(employees)
        .values({
          storeId: store.id,
          roleId: ownerRole.id,
          name: body.ownerName,
          email: body.email,
          passwordHash: encoded,
        })
        .returning();
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
      const [existing] = await tx
        .select()
        .from(devices)
        .where(
          and(
            eq(devices.tokenHash, hash(cookie(req, 'eliza_device'))),
            eq(devices.storeId, user.storeId),
          ),
        );
      if (existing && !existing.active)
        throw new UnauthorizedException('This device has been blocked. Contact the store owner.');
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
      secure: process.env.NODE_ENV === 'production',
      path: '/api',
    };
    res.cookie('eliza_session', secret, { ...options, maxAge: 12 * 3600_000 });
    if (device.isNew)
      res.cookie('eliza_device', newDeviceToken, { ...options, maxAge: 365 * 86400_000 });
    return { ok: true };
  }
}
@Controller('auth')
export class AuthController {
  constructor(
    private database: Database,
    private auth: AuthService,
  ) {}
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
    this.auth.limit(req.ip ?? 'local');
    const user = await this.auth.setup(body);
    return this.auth.issue(user, req, res);
  }
  @Post('login') @HttpCode(200) async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.auth.limit(req.ip ?? 'local');
    return this.auth.issue(await this.auth.login(body), req, res);
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
