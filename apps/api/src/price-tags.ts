import { readOnboarding, saveOnboarding } from './onboarding.js';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Module,
  Post,
  Param,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { encodeScaleBarcode, employeeUnlockSchema, scaleBarcodeSchema } from '@eliza/contracts';
import { Database } from './database.js';
import { cookie, hash, parse, token, verifyPassword } from './security.js';
import { cookieOptions } from './register.js';
import { resolvePrice } from './pricing-engine.js';

@Controller('price-tags')
export class PriceTagsController {
  constructor(private database: Database) {}
  private async availableMarkdownLabels(store: string, ids: string[] | null = null) {
    return (
      await this.database.pool.query(
        `SELECT u.id,u.barcode,p.id AS "productId",p.name,p.sku,
          m.final_unit_price::text AS price,m.original_unit_price::text AS "regularPrice",
          b.expiry_date AS "expiryDate",m.valid_until AS "validUntil"
         FROM markdown_units u
         JOIN markdowns m ON m.id=u.markdown_id AND m.store_id=u.store_id
         JOIN products p ON p.id=u.product_id AND p.store_id=u.store_id
         JOIN stock_batches b ON b.id=u.batch_id AND b.store_id=u.store_id
         JOIN stores s ON s.id=u.store_id
         WHERE u.store_id=$1 AND ($2::uuid[] IS NULL OR u.id=ANY($2::uuid[]))
           AND u.status='AVAILABLE' AND u.cancelled_at IS NULL
           AND m.cancelled_at IS NULL AND m.valid_from<=now()
           AND (m.valid_until IS NULL OR m.valid_until>now())
           AND p.active AND b.quantity>=1
           AND (b.expiry_date IS NULL OR b.expiry_date>(now() AT TIME ZONE s.timezone)::date)
         ORDER BY m.created_at DESC,u.created_at DESC,u.id`,
        [store, ids],
      )
    ).rows;
  }
  private async priced(store: string, rows: any[]) {
    return Promise.all(
      rows.map(async (row) => {
        const current = await resolvePrice(this.database.pool as any, store, {
          id: row.id,
          price: row.price,
          category_id: row.categoryId,
          price_kind: row.priceKind,
        });
        return {
          ...row,
          price: current.price,
          regularPrice: current.source === 'BASE' ? row.regularPrice : current.basePrice,
          priceChanged:
            row.priceChanged ||
            (row.lastPrintedPrice !== null && row.lastPrintedPrice !== current.price),
        };
      }),
    );
  }
  private async station(req: Request) {
    const result = await this.database.pool.query(
      'SELECT d.id,d.store_id,d.name,d.type,d.active,s.name AS store_name,s.currency,s.scale_barcode,s.tag_design FROM devices d JOIN stores s ON s.id=d.store_id WHERE d.token_hash=$1 OR d.token_hash=$2 ORDER BY CASE WHEN d.token_hash=$1 THEN 0 ELSE 1 END LIMIT 1',
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
  @Get('onboarding') async onboarding(@Req() req: Request) {
    const { device, employee } = await this.operator(req);
    return readOnboarding(this.database.pool, {
      storeId: device.store_id,
      employeeId: employee.id,
    });
  }
  @Post('onboarding') async saveOnboarding(@Req() req: Request, @Body() body: unknown) {
    const { device, employee } = await this.operator(req);
    return saveOnboarding(
      this.database.pool,
      { storeId: device.store_id, employeeId: employee.id },
      body,
    );
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
      store: {
        id: device.store_id,
        name: device.store_name,
        currency: device.currency,
        scaleBarcode: device.scale_barcode,
        tagDesign: device.tag_design,
      },
      employees: employees.rows,
      operator,
    };
  }
  @Post('login') @HttpCode(200) async login(
    @Body() input: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const body = parse(employeeUnlockSchema, input);
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
          "SELECT e.id,e.name,e.pin_hash,e.active,EXISTS (SELECT 1 FROM employee_roles er JOIN roles r ON r.id=er.role_id AND r.store_id=er.store_id WHERE er.employee_id=e.id AND er.store_id=e.store_id AND r.name='General employee') AS general_employee FROM employees e WHERE e.store_id=$1 AND (CASE WHEN $3::text IS NULL THEN e.employee_code=$2 ELSE EXISTS(SELECT 1 FROM employee_qr_credentials ec WHERE ec.employee_id=e.id AND ec.store_id=e.store_id AND ec.token_hash=$3) END)",
          [
            device.store_id,
            'pin' in body ? body.employeeCode : null,
            'qrCredential' in body ? hash(body.qrCredential) : null,
          ],
        )
      ).rows[0];
      const valid =
        'qrCredential' in body ||
        (await verifyPassword(
          body.pin,
          employee?.pin_hash ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`,
        ));
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
    const rows = (
      await this.database.pool.query(
        'SELECT p.id,p.name,p.sku,p.category_id AS "categoryId",p.price_kind AS "priceKind",p.price::text,p.regular_price::text AS "regularPrice",p.tag_last_printed_price::text AS "lastPrintedPrice",p.unit,p.plu,p.tag_price_version AS "priceVersion",(p.tag_price_version>p.tag_printed_version) AS "priceChanged",COALESCE((SELECT b.value FROM barcodes b WHERE b.product_id=p.id AND b.store_id=p.store_id ORDER BY b.value LIMIT 1),\'\') AS barcode,COALESCE((SELECT jsonb_agg(b.value ORDER BY b.value) FROM barcodes b WHERE b.product_id=p.id AND b.store_id=p.store_id),\'[]\'::jsonb) AS barcodes FROM products p WHERE p.store_id=$1 AND p.active AND p.price IS NOT NULL AND p.base_product_id IS NULL ORDER BY p.name',
        [device.store_id],
      )
    ).rows;
    return this.priced(device.store_id, rows);
  }
  @Get('markdown-labels') async markdownLabels(@Req() req: Request) {
    const { device } = await this.operator(req);
    return this.availableMarkdownLabels(device.store_id);
  }
  @Post('markdown-prints') async markdownPrints(@Req() req: Request, @Body() input: unknown) {
    const body = parse(z.object({ unitIds: z.array(z.uuid()).min(1).max(100) }), input);
    const { device } = await this.operator(req);
    const ids = [...new Set(body.unitIds)];
    if (ids.length !== body.unitIds.length)
      throw new BadRequestException('Choose each markdown label only once.');
    const labels = await this.availableMarkdownLabels(device.store_id, ids);
    if (labels.length !== ids.length)
      throw new ForbiddenException(
        'One or more markdown labels are no longer available. Refresh the list.',
      );
    return { labels };
  }
  @Post('weight-barcode') async weightBarcode(@Req() req: Request, @Body() input: unknown) {
    const body = parse(
      z.object({
        productId: z.uuid(),
        weight: z.string().regex(/^\d+(?:\.\d{1,3})?$/),
      }),
      input,
    );
    const { device } = await this.operator(req);
    const product = (
      await this.database.pool.query(
        'SELECT id,name,sku,price::text,category_id,price_kind,unit,plu FROM products WHERE store_id=$1 AND id=$2 AND active',
        [device.store_id, body.productId],
      )
    ).rows[0];
    if (!product || product.unit !== 'kilogram')
      throw new BadRequestException('Choose an active product sold by kilogram.');
    const profile = scaleBarcodeSchema.parse(device.scale_barcode);
    const current = await resolvePrice(this.database.pool as any, device.store_id, product);
    try {
      return {
        barcode: encodeScaleBarcode(product.plu ?? '', body.weight, profile),
        productId: product.id,
        name: product.name,
        sku: product.sku,
        price: current.price,
        weight: body.weight,
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid weight barcode.',
      );
    }
  }
  @Post('prints') async print(@Req() req: Request, @Body() input: unknown) {
    const body = parse(z.object({ productIds: z.array(z.uuid()).min(1).max(100) }), input);
    const { device, employee } = await this.operator(req);
    const products = await this.database.pool.query(
      'SELECT p.id,p.name,p.sku,p.category_id AS "categoryId",p.price_kind AS "priceKind",p.price::text,p.regular_price::text AS "regularPrice",p.tag_last_printed_price::text AS "lastPrintedPrice",p.unit,p.plu,p.tag_price_version AS "priceVersion",(p.tag_price_version>p.tag_printed_version) AS "priceChanged",COALESCE((SELECT b.value FROM barcodes b WHERE b.product_id=p.id AND b.store_id=p.store_id ORDER BY b.value LIMIT 1),\'\') AS barcode,COALESCE((SELECT jsonb_agg(b.value ORDER BY b.value) FROM barcodes b WHERE b.product_id=p.id AND b.store_id=p.store_id),\'[]\'::jsonb) AS barcodes FROM products p WHERE p.store_id=$1 AND p.active AND p.price IS NOT NULL AND p.base_product_id IS NULL AND p.id=ANY($2::uuid[])',
      [device.store_id, body.productIds],
    );
    if (products.rows.length !== new Set(body.productIds).size)
      throw new ForbiddenException('One or more products are unavailable. Refresh the list.');
    const priced = await this.priced(device.store_id, products.rows);
    const job = await this.database.pool.query(
      'INSERT INTO price_tag_prints(store_id,device_id,employee_id,products) VALUES($1,$2,$3,$4) RETURNING id',
      [device.store_id, device.id, employee.id, JSON.stringify(priced)],
    );
    return { id: job.rows[0].id, products: priced };
  }
  @Post('prints/:id/complete') @HttpCode(200) async complete(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const jobId = parse(z.uuid(), id);
    const { device } = await this.operator(req);
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const job = (
        await client.query(
          'SELECT products,completed_at FROM price_tag_prints WHERE id=$1 AND store_id=$2 AND device_id=$3 FOR UPDATE',
          [jobId, device.store_id, device.id],
        )
      ).rows[0];
      if (!job) throw new ForbiddenException('This print job is unavailable.');
      if (!job.completed_at) {
        for (const product of job.products) {
          await client.query(
            'UPDATE products SET tag_printed_version=$3,tag_last_printed_price=$4 WHERE id=$1 AND store_id=$2 AND tag_price_version=$3',
            [product.id, device.store_id, product.priceVersion, product.price],
          );
        }
        await client.query('UPDATE price_tag_prints SET completed_at=now() WHERE id=$1', [jobId]);
      }
      await client.query('COMMIT');
      return { ok: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
@Module({ controllers: [PriceTagsController] })
export class PriceTagsModule {}
