import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Module,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { pinLoginSchema } from '@eliza/contracts';
import { Database } from './database.js';
import { cookie, hash, parse, token, verifyPassword } from './security.js';
import { cookieOptions } from './register.js';

@Controller('price-tags')
export class PriceTagsController {
  constructor(private database: Database) {}
  private async station(req: Request) {
    const result = await this.database.pool.query(
      'SELECT d.id,d.store_id,d.name,d.type,d.active,s.name AS store_name,s.currency FROM devices d JOIN stores s ON s.id=d.store_id WHERE d.token_hash=$1 OR d.token_hash=$2 ORDER BY CASE WHEN d.token_hash=$1 THEN 0 ELSE 1 END LIMIT 1',
      [hash(cookie(req, 'eliza_register')), hash(cookie(req, 'eliza_device'))],
    );
    const device = result.rows[0];
    if (!device)
      throw new UnauthorizedException(
        'This device is not assigned to Price Tags. Ask a manager to assign it in Devices.',
      );
    if (device.type !== 'price_tags')
      throw new ForbiddenException('This device is assigned to another workspace.');
    if (!device.active) throw new ForbiddenException('This device is blocked.');
    return device;
  }
  private async operator(req: Request) {
    const device = await this.station(req);
    const result = await this.database.pool.query(
      "SELECT e.id,e.name FROM price_tag_sessions ps JOIN employees e ON e.id=ps.employee_id AND e.store_id=$2 WHERE ps.token_hash=$1 AND ps.device_id=$3 AND ps.expires_at>now() AND e.active AND EXISTS (SELECT 1 FROM employee_roles er JOIN roles r ON r.id=er.role_id AND r.store_id=er.store_id WHERE er.employee_id=e.id AND er.store_id=e.store_id AND r.name='General employee')",
      [hash(cookie(req, 'eliza_price_tags_session')), device.store_id, device.id],
    );
    if (!result.rows[0])
      throw new UnauthorizedException('Price Tags is locked. Sign in with your PIN.');
    return { device, employee: result.rows[0] };
  }
  @Get('context') async context(@Req() req: Request) {
    const device = await this.station(req);
    const employees = await this.database.pool.query(
      'SELECT name,employee_code AS "employeeCode" FROM employees e WHERE e.store_id=$1 AND e.active AND EXISTS (SELECT 1 FROM employee_roles er JOIN roles r ON r.id=er.role_id AND r.store_id=er.store_id WHERE er.employee_id=e.id AND er.store_id=e.store_id AND r.name=\'General employee\') AND e.pin_hash IS NOT NULL ORDER BY name',
      [device.store_id],
    );
    let operator: { id: string; name: string } | null = null;
    try {
      operator = (await this.operator(req)).employee;
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
    }
    return {
      device: { id: device.id, name: device.name },
      store: { name: device.store_name, currency: device.currency },
      employees: employees.rows,
      operator,
    };
  }
  @Post('login') @HttpCode(200) async login(
    @Body() input: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const body = parse(pinLoginSchema, input);
    const device = await this.station(req);
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO pin_attempts(device_id) VALUES($1) ON CONFLICT DO NOTHING', [
        device.id,
      ]);
      const attempt = (
        await client.query('SELECT * FROM pin_attempts WHERE device_id=$1 FOR UPDATE', [device.id])
      ).rows[0];
      if (attempt.locked_until && new Date(attempt.locked_until).getTime() > Date.now())
        throw new ForbiddenException('Too many incorrect PINs. Try again in five minutes.');
      const employee = (
        await client.query(
          "SELECT e.id,e.name,e.pin_hash,e.active,EXISTS (SELECT 1 FROM employee_roles er JOIN roles r ON r.id=er.role_id AND r.store_id=er.store_id WHERE er.employee_id=e.id AND er.store_id=e.store_id AND r.name='General employee') AS general_employee FROM employees e WHERE e.store_id=$1 AND e.employee_code=$2",
          [device.store_id, body.employeeCode],
        )
      ).rows[0];
      const valid = await verifyPassword(
        body.pin,
        employee?.pin_hash ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`,
      );
      if (!employee?.active || !employee.general_employee || !valid) {
        const failures = attempt.locked_until ? 1 : attempt.failures + 1;
        await client.query(
          "UPDATE pin_attempts SET failures=$2,locked_until=CASE WHEN $2>=5 THEN now()+interval '5 minutes' ELSE NULL END WHERE device_id=$1",
          [device.id, failures],
        );
        await client.query('COMMIT');
        throw new UnauthorizedException(
          'Employee or PIN is incorrect, or General employee role is not assigned.',
        );
      }
      await client.query(
        'UPDATE pin_attempts SET failures=0,locked_until=NULL WHERE device_id=$1',
        [device.id],
      );
      const secret = token();
      await client.query('DELETE FROM price_tag_sessions WHERE device_id=$1', [device.id]);
      await client.query(
        "INSERT INTO price_tag_sessions(token_hash,device_id,employee_id,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')",
        [hash(secret), device.id, employee.id],
      );
      await client.query(
        "INSERT INTO audits(store_id,employee_id,device_id,action,entity_id,details) VALUES($1,$2,$3,'Price Tags unlocked',$3,'{}')",
        [device.store_id, employee.id, device.id],
      );
      await client.query('COMMIT');
      res.cookie('eliza_price_tags_session', secret, { ...cookieOptions, maxAge: 12 * 3600_000 });
      return { ok: true };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  @Post('lock') @HttpCode(200) async lock(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const device = await this.station(req);
    await this.database.pool.query(
      'DELETE FROM price_tag_sessions WHERE device_id=$1 AND token_hash=$2',
      [device.id, hash(cookie(req, 'eliza_price_tags_session'))],
    );
    res.clearCookie('eliza_price_tags_session', { path: '/api' });
    return { ok: true };
  }
  @Get('products') async products(@Req() req: Request) {
    const { device } = await this.operator(req);
    return (
      await this.database.pool.query(
        "SELECT p.id,p.name,p.sku,p.price::text,p.unit,p.plu,COALESCE((SELECT b.value FROM barcodes b WHERE b.product_id=p.id AND b.store_id=p.store_id ORDER BY b.value LIMIT 1),'') AS barcode,COALESCE((SELECT jsonb_agg(b.value ORDER BY b.value) FROM barcodes b WHERE b.product_id=p.id AND b.store_id=p.store_id),'[]'::jsonb) AS barcodes FROM products p WHERE p.store_id=$1 AND p.active ORDER BY p.name",
        [device.store_id],
      )
    ).rows;
  }
  @Post('prints') async print(@Req() req: Request, @Body() input: unknown) {
    const body = parse(z.object({ productIds: z.array(z.uuid()).min(1).max(100) }), input);
    const { device, employee } = await this.operator(req);
    const products = await this.database.pool.query(
      "SELECT p.id,p.name,p.sku,p.price::text,p.unit,p.plu,COALESCE((SELECT b.value FROM barcodes b WHERE b.product_id=p.id AND b.store_id=p.store_id ORDER BY b.value LIMIT 1),'') AS barcode,COALESCE((SELECT jsonb_agg(b.value ORDER BY b.value) FROM barcodes b WHERE b.product_id=p.id AND b.store_id=p.store_id),'[]'::jsonb) AS barcodes FROM products p WHERE p.store_id=$1 AND p.active AND p.id=ANY($2::uuid[])",
      [device.store_id, body.productIds],
    );
    if (products.rows.length !== new Set(body.productIds).size)
      throw new ForbiddenException('One or more products are unavailable. Refresh the list.');
    await this.database.pool.query(
      'INSERT INTO price_tag_prints(store_id,device_id,employee_id,products) VALUES($1,$2,$3,$4)',
      [device.store_id, device.id, employee.id, JSON.stringify(products.rows)],
    );
    return { products: products.rows };
  }
}
@Module({ controllers: [PriceTagsController] })
export class PriceTagsModule {}
