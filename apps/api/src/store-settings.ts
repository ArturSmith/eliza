import { scaleBarcodeSchema, defaultMarkupSchema } from '@eliza/contracts';
import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Module,
  UseGuards,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { z } from 'zod';
import { Database } from './database.js';
import { AuthModule } from './auth.js';
import { AccessGuard, Require, parse, hash, cookie, type AuthRequest } from './security.js';
import { Operations, audit } from './operations.js';
export const profileColumns = `name,currency,timezone,address,phone,business_number AS "businessNumber",receipt_footer AS "receiptFooter",default_tax_rate AS "defaultTaxRate",default_markup_percent AS "defaultMarkupPercent",scale_barcode AS "scaleBarcode",settings_version AS version`;
@Controller('store-profile')
@UseGuards(AccessGuard)
class StoreSettingsController {
  constructor(
    private database: Database,
    private operations: Operations,
  ) {}
  @Get() @Require('catalog.read') async get(@Req() req: AuthRequest) {
    return (
      await this.database.pool.query(`SELECT ${profileColumns} FROM stores WHERE id=$1`, [
        req.context.store.id,
      ])
    ).rows[0];
  }
  @Post() @Require('settings.manage') save(@Body() input: unknown, @Req() req: AuthRequest) {
    const b = parse(
      z.object({
        scaleBarcode: scaleBarcodeSchema.optional(),
        defaultMarkupPercent: defaultMarkupSchema.optional(),
        version: z.number().int().positive(),
        name: z.string().trim().min(1).max(120),
        address: z.string().trim().max(500),
        phone: z.string().trim().max(50),
        businessNumber: z.string().trim().max(100),
        receiptFooter: z.string().trim().max(500),
        defaultTaxRate: z
          .string()
          .regex(/^\d{1,3}(\.\d{1,2})?$/)
          .refine((v) => Number(v) <= 100),
      }),
      input,
    );
    return this.operations.transaction(async (c) => {
      const role = (
        await c.query(
          "SELECT (SELECT COALESCE(jsonb_agg(DISTINCT p.value),'[]'::jsonb) FROM employee_roles er JOIN roles rr ON rr.id=er.role_id AND rr.store_id=er.store_id CROSS JOIN LATERAL jsonb_array_elements_text(rr.permissions) p(value) WHERE er.employee_id=e.id AND er.store_id=e.store_id) AS permissions FROM sessions s JOIN employees e ON e.id=s.employee_id JOIN roles r ON r.id=e.role_id JOIN devices d ON d.id=s.device_id WHERE s.token_hash=$1 AND s.expires_at>now() AND e.active AND d.active AND e.store_id=$2 AND r.store_id=$2 AND d.store_id=$2 FOR SHARE OF s,e,r,d",
          [hash(cookie(req, 'eliza_session')), req.context.store.id],
        )
      ).rows[0];
      if (!role?.permissions.includes('settings.manage'))
        throw new ForbiddenException('Your access changed. Sign in again.');
      const old = (
        await c.query(`SELECT ${profileColumns} FROM stores WHERE id=$1 FOR UPDATE`, [
          req.context.store.id,
        ])
      ).rows[0];
      if (old.version !== b.version)
        throw new ConflictException('Store settings changed. Reload to review the saved settings.');
      const result = (
        await c.query(
          `UPDATE stores SET name=$2,address=$3,phone=$4,business_number=$5,receipt_footer=$6,default_tax_rate=$7,scale_barcode=$8::jsonb,default_markup_percent=$9,settings_version=settings_version+1 WHERE id=$1 RETURNING ${profileColumns}`,
          [
            req.context.store.id,
            b.name,
            b.address,
            b.phone,
            b.businessNumber,
            b.receiptFooter,
            b.defaultTaxRate,
            JSON.stringify(b.scaleBarcode ?? old.scaleBarcode),
            b.defaultMarkupPercent ?? old.defaultMarkupPercent,
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
        'Store settings updated',
        req.context.store.id,
        { before: old, after: result },
      );
      return result;
    });
  }
}
@Module({ imports: [AuthModule], controllers: [StoreSettingsController], providers: [Operations] })
export class StoreSettingsModule {}
