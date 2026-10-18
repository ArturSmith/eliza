import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Module,
  NotFoundException,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  decodeScaleBarcode,
  fromScaled,
  scaleBarcodeSchema,
  scalePriceQuantity,
  toScaled,
} from '@eliza/contracts';
import { Database, DatabaseModule } from './database.js';
import { resolvePrice } from './pricing-engine.js';
import { cookie, hash } from './security.js';

// Only customer-facing catalog fields belong in the kiosk response.
const productFields = `p.id,p.name,p.description,p.image,p.category,p.unit,
  COALESCE(p.source->>'brand','') AS brand,
  COALESCE(p.source->>'quantity','') AS "packageQuantity",
  p.price::text,p.regular_price::text,p.price_kind,p.category_id`;

@Controller('price-check')
export class PriceCheckController {
  constructor(private database: Database) {}

  private async station(req: Request) {
    const device = (
      await this.database.pool.query(
        `SELECT d.id,d.store_id,d.type,d.active,d.removed_at,s.name AS store_name,
          s.currency,s.scale_barcode
         FROM devices d JOIN stores s ON s.id=d.store_id
         WHERE d.token_hash=$1 OR d.token_hash=$2
         ORDER BY CASE WHEN d.token_hash=$1 THEN 0 ELSE 1 END LIMIT 1`,
        [hash(cookie(req, 'eliza_register')), hash(cookie(req, 'eliza_device'))],
      )
    ).rows[0];
    if (!device) throw new UnauthorizedException('This price checker has not been registered.');
    if (device.type !== 'price_check')
      throw new ForbiddenException('This device is assigned to another workspace.');
    if (!device.active || device.removed_at)
      throw new ForbiddenException('This price checker is blocked.');
    return device;
  }

  @Get('context') async context(@Req() req: Request) {
    const station = await this.station(req);
    return {
      deviceId: station.id,
      storeId: station.store_id,
      storeName: station.store_name,
      currency: station.currency,
    };
  }

  @Get('lookup') async lookup(@Req() req: Request, @Query('code') input: string) {
    const code = input?.trim();
    if (!code || code.length > 100) throw new BadRequestException('Scan a valid barcode.');
    const station = await this.station(req);
    const markdown = (
      await this.database.pool.query(
        'SELECT id,product_id FROM markdown_units WHERE store_id=$1 AND barcode=$2',
        [station.store_id, code],
      )
    ).rows[0];
    let decoded: ReturnType<typeof decodeScaleBarcode> = null;
    if (!markdown) {
      try {
        decoded = decodeScaleBarcode(code, scaleBarcodeSchema.parse(station.scale_barcode));
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : 'Invalid scale barcode.',
        );
      }
    }
    const products = await this.database.pool.query(
      markdown
        ? `SELECT ${productFields}
           FROM products p WHERE p.store_id=$1 AND p.id=$2 AND p.active`
        : decoded
          ? `SELECT ${productFields}
             FROM products p WHERE p.store_id=$1 AND p.active AND p.plu ~ '^[0-9]+$'
               AND ltrim(p.plu,'0')=ltrim($2,'0')`
          : `SELECT ${productFields}
             FROM products p JOIN barcodes b ON b.product_id=p.id AND b.store_id=p.store_id
             WHERE p.store_id=$1 AND p.active AND b.value=$2`,
      [station.store_id, markdown?.product_id ?? decoded?.productCode ?? code],
    );
    if (!products.rows.length)
      throw new NotFoundException('Barcode not found. Ask a staff member.');
    if (products.rows.length !== 1)
      throw new BadRequestException('Barcode matches multiple products. Ask a staff member.');
    const product = products.rows[0];
    if (decoded && product.unit !== 'kilogram')
      throw new BadRequestException('Scale barcode does not belong to a product sold by kilogram.');
    if (product.price == null && !markdown)
      throw new NotFoundException('Selling price is not set for this product.');
    let resolved;
    try {
      resolved = await resolvePrice(
        this.database.pool as any,
        station.store_id,
        product,
        markdown?.id,
      );
    } catch {
      throw new NotFoundException('This discounted label is no longer valid. Ask a staff member.');
    }
    const quantity = decoded
      ? (decoded.quantity ?? scalePriceQuantity(decoded.price!, resolved.price))
      : null;
    const totalPrice = decoded
      ? (decoded.price ??
        fromScaled((toScaled(resolved.price, 2) * toScaled(quantity!, 3) + 500n) / 1000n, 2))
      : null;
    return {
      name: product.name,
      description: product.description,
      image: product.image,
      category: product.category,
      brand: product.brand,
      packageQuantity: product.packageQuantity,
      barcode: code,
      unit: product.unit,
      price: resolved.price,
      regularPrice: resolved.source === 'BASE' ? null : resolved.basePrice,
      discountType:
        resolved.source === 'MARKDOWN' || resolved.source === 'LEGACY_MARKDOWN'
          ? 'markdown'
          : resolved.source === 'BASE'
            ? null
            : 'promotion',
      quantity,
      totalPrice,
    };
  }
}

@Module({ imports: [DatabaseModule], controllers: [PriceCheckController] })
export class PriceCheckModule {}
