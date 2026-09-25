import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Injectable,
  Module,
  Post,
  Req,
  Res,
  UseGuards,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pinLoginSchema, type PosContext, type Permission } from '@eliza/contracts';
import { Database } from './database.js';
import { AuthModule } from './auth.js';
import {
  AccessGuard,
  type AuthRequest,
  Require,
  parse,
  cookie,
  hash,
  token,
  verifyPassword,
} from './security.js';
import { Operations, audit, type Actor } from './operations.js';
export type Operator = Actor & {
  name: string;
  employeeCode: string;
  permissions: Permission[];
  deviceName: string;
  storeName: string;
  currency: string;
  timezone: string;
};
export const cookieOptions = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/api',
};
export async function shiftRow(client: PoolClient, id: string) {
  return (
    await client.query(
      `SELECT s.id,s.status,e.name AS "employeeName",e.id AS "cashierId",d.name AS "deviceName",s.opening_cash AS "openingCash",COALESCE(s.expected_cash,(SELECT COALESCE(sum(amount),0) FROM cash_movements WHERE shift_id=s.id))::numeric(14,2)::text AS "expectedCash",s.counted_cash AS "countedCash",s.difference,s.opened_at AS "openedAt",s.closed_at AS "closedAt",s.notes FROM shifts s JOIN employees e ON s.employee_id=e.id JOIN devices d ON s.device_id=d.id WHERE s.id=$1`,
      [id],
    )
  ).rows[0];
}
@Injectable()
export class RegisterService {
  constructor(
    private database: Database,
    private operations: Operations,
  ) {}
  async device(client: PoolClient, req: Request) {
    const row = (
      await client.query(
        'SELECT * FROM devices WHERE token_hash=$1 OR token_hash=$2 ORDER BY CASE WHEN token_hash=$1 THEN 0 ELSE 1 END LIMIT 1 FOR UPDATE',
        [hash(cookie(req, 'eliza_register')), hash(cookie(req, 'eliza_device'))],
      )
    ).rows[0];
    if (!row) throw new UnauthorizedException('This browser needs register enrollment.');
    if (row.type !== 'pos')
      throw new ForbiddenException('This device is assigned to another workspace.');
    if (!row.active) throw new ForbiddenException('This register is blocked. Contact the owner.');
    return row;
  }
  async operator(client: PoolClient, req: Request): Promise<Operator> {
    const device = await this.device(client, req);
    const row = (
      await client.query(
        `SELECT e.id,e.name,e.employee_code,(SELECT COALESCE(jsonb_agg(DISTINCT p.value),\'[]\'::jsonb) FROM employee_roles er JOIN roles rr ON rr.id=er.role_id AND rr.store_id=er.store_id CROSS JOIN LATERAL jsonb_array_elements_text(rr.permissions) p(value) WHERE er.employee_id=e.id AND er.store_id=e.store_id) AS permissions,s.name AS store_name,s.currency,s.timezone FROM pos_sessions ps JOIN employees e ON e.id=ps.employee_id JOIN roles r ON r.id=e.role_id AND r.store_id=e.store_id JOIN stores s ON s.id=e.store_id WHERE ps.token_hash=$1 AND ps.device_id=$2 AND ps.expires_at>now() AND e.active AND e.store_id=$3 FOR SHARE OF e,r`,
        [hash(cookie(req, 'eliza_pos_session')), device.id, device.store_id],
      )
    ).rows[0];
    if (!row || !row.permissions.includes('pos.access'))
      throw new UnauthorizedException('Register locked. Sign in with your PIN.');
    return {
      storeId: device.store_id,
      deviceId: device.id,
      employeeId: row.id,
      name: row.name,
      employeeCode: row.employee_code,
      permissions: row.permissions,
      deviceName: device.name,
      storeName: row.store_name,
      currency: row.currency,
      timezone: row.timezone,
    };
  }
  async checkPin(
    client: PoolClient,
    deviceId: string,
    storeId: string,
    credentials: { employeeCode: string; pin: string },
    permission: Permission,
  ) {
    await client.query('INSERT INTO pin_attempts(device_id) VALUES($1) ON CONFLICT DO NOTHING', [
      deviceId,
    ]);
    const attempt = (
      await client.query('SELECT * FROM pin_attempts WHERE device_id=$1 FOR UPDATE', [deviceId])
    ).rows[0];
    if (attempt.locked_until && new Date(attempt.locked_until).getTime() > Date.now())
      return new HttpException('Too many incorrect PINs. Try again in five minutes.', 429);
    const employee = (
      await client.query(
        "SELECT e.*,(SELECT COALESCE(jsonb_agg(DISTINCT p.value),'[]'::jsonb) FROM employee_roles er JOIN roles rr ON rr.id=er.role_id AND rr.store_id=er.store_id CROSS JOIN LATERAL jsonb_array_elements_text(rr.permissions) p(value) WHERE er.employee_id=e.id AND er.store_id=e.store_id) AS permissions FROM employees e JOIN roles r ON e.role_id=r.id AND e.store_id=r.store_id WHERE e.store_id=$1 AND e.employee_code=$2 FOR SHARE OF e,r",
        [storeId, credentials.employeeCode],
      )
    ).rows[0];
    const valid = await verifyPassword(
      credentials.pin,
      employee?.pin_hash ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`,
    );
    if (!employee || !employee.active || !valid || !employee.permissions.includes(permission)) {
      const failures = attempt.locked_until ? 1 : attempt.failures + 1;
      await client.query(
        "UPDATE pin_attempts SET failures=$2,locked_until=CASE WHEN $2>=5 THEN now()+interval '5 minutes' ELSE NULL END WHERE device_id=$1",
        [deviceId, failures],
      );
      return new UnauthorizedException(
        'Employee code or PIN is incorrect, or this employee cannot approve the action.',
      );
    }
    await client.query('UPDATE pin_attempts SET failures=0,locked_until=NULL WHERE device_id=$1', [
      deviceId,
    ]);
    return employee;
  }
  async context(req: Request): Promise<PosContext> {
    return this.operations.transaction(async (client) => {
      const device = (
        await client.query(
          'SELECT d.*,s.name AS store_name,s.currency,s.timezone FROM devices d JOIN stores s ON s.id=d.store_id WHERE d.token_hash=$1 OR d.token_hash=$2 ORDER BY CASE WHEN d.token_hash=$1 THEN 0 ELSE 1 END LIMIT 1',
          [hash(cookie(req, 'eliza_register')), hash(cookie(req, 'eliza_device'))],
        )
      ).rows[0];
      if (!device) return { registered: false };
      if (device.type !== 'pos')
        throw new ForbiddenException('This device is assigned to another workspace.');
      if (!device.active) return { registered: true, blocked: true };
      const base: PosContext = {
        registered: true,
        device: { id: device.id, name: device.name },
        store: {
          id: device.store_id,
          name: device.store_name,
          currency: device.currency,
          timezone: device.timezone,
        },
        employees: (
          await client.query(
            'SELECT e.name,e.employee_code AS "employeeCode" FROM employees e WHERE e.store_id=$1 AND e.active AND e.pin_hash IS NOT NULL AND EXISTS (SELECT 1 FROM employee_roles er JOIN roles r ON r.id=er.role_id AND r.store_id=er.store_id WHERE er.employee_id=e.id AND er.store_id=e.store_id AND r.permissions ? \'pos.access\') ORDER BY e.name',
            [device.store_id],
          )
        ).rows,
      };
      try {
        const operator = await this.operator(client, req);
        base.operator = {
          id: operator.employeeId,
          name: operator.name,
          employeeCode: operator.employeeCode,
          permissions: operator.permissions,
        };
        const shift = (
          await client.query(
            "SELECT id FROM shifts WHERE device_id=$1 AND employee_id=$2 AND status='open'",
            [device.id, operator.employeeId],
          )
        ).rows[0];
        base.shift = shift ? await shiftRow(client, shift.id) : null;
      } catch (error) {
        if (!(error instanceof UnauthorizedException)) throw error;
      }
      return base;
    });
  }
  async endManagement(req: Request, res: Response) {
    await this.database.pool.query('DELETE FROM sessions WHERE token_hash=$1', [
      hash(cookie(req, 'eliza_session')),
    ]);
    res.clearCookie('eliza_session', { path: '/api' });
  }
  async enroll(input: unknown, req: AuthRequest, res: Response) {
    const body = parse(z.object({ name: z.string().trim().min(1).max(120) }), input);
    const { user, store, device } = req.context;
    const secret = token();
    const result = await this.operations.transaction(async (client) => {
      const existing = (
        await client.query("SELECT id FROM devices WHERE token_hash=$1 AND type='pos'", [
          hash(cookie(req, 'eliza_register')),
        ])
      ).rows[0];
      if (existing)
        throw new ConflictException(
          'This browser is already enrolled. Manage its device record instead.',
        );
      const created = (
        await client.query(
          "INSERT INTO devices(store_id,name,type,token_hash) VALUES($1,$2,'pos',$3) RETURNING id",
          [store.id, body.name, hash(secret)],
        )
      ).rows[0];
      await audit(
        client,
        { storeId: store.id, employeeId: user.id, deviceId: device.id },
        'Register enrolled',
        created.id,
        { name: body.name },
      );
      return created;
    });
    await this.endManagement(req, res);
    res.cookie('eliza_register', secret, { ...cookieOptions, maxAge: 365 * 86400_000 });
    return result;
  }
  async login(input: unknown, req: Request, res: Response) {
    const credentials = parse(pinLoginSchema, input);
    const secret = token();
    const result = await this.operations.transaction(async (client) => {
      const device = await this.device(client, req);
      const employee = await this.checkPin(
        client,
        device.id,
        device.store_id,
        credentials,
        'pos.access',
      );
      if (employee instanceof HttpException) return employee;
      const shift = (
        await client.query("SELECT employee_id FROM shifts WHERE device_id=$1 AND status='open'", [
          device.id,
        ])
      ).rows[0];
      if (shift && shift.employee_id !== employee.id)
        throw new ConflictException(
          'The current cashier must close their shift before another employee takes over.',
        );
      await client.query('DELETE FROM pos_sessions WHERE device_id=$1', [device.id]);
      await client.query(
        "INSERT INTO pos_sessions(token_hash,device_id,employee_id,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')",
        [hash(secret), device.id, employee.id],
      );
      await audit(
        client,
        { storeId: device.store_id, employeeId: employee.id, deviceId: device.id },
        'Register unlocked',
        device.id,
        {},
      );
      return { ok: true };
    });
    await this.endManagement(req, res);
    res.cookie('eliza_pos_session', secret, { ...cookieOptions, maxAge: 12 * 3600_000 });
    return result;
  }
  async lock(req: Request, res: Response) {
    await this.operations.transaction(async (client) => {
      const device = await this.device(client, req);
      await client.query('DELETE FROM pos_sessions WHERE device_id=$1', [device.id]);
    });
    res.clearCookie('eliza_pos_session', { path: '/api' });
    return { ok: true };
  }
}
@Controller('pos')
export class RegisterController {
  constructor(private registers: RegisterService) {}
  @Post('enter') async enter(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const context = await this.registers.context(req);
    if (context.registered) await this.registers.endManagement(req, res);
    return context;
  }
  @Get('context') context(@Req() req: Request) {
    return this.registers.context(req);
  }
  @Post('enroll') @UseGuards(AccessGuard) @Require('devices.manage') enroll(
    @Body() body: unknown,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.registers.enroll(body, req, res);
  }
  @Post('login') @HttpCode(200) login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.registers.login(body, req, res);
  }
  @Post('lock') @HttpCode(200) lock(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.registers.lock(req, res);
  }
}
@Module({
  imports: [AuthModule],
  providers: [Operations, RegisterService],
  controllers: [RegisterController],
  exports: [Operations, RegisterService],
})
export class RegisterModule {}
