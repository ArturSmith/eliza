import { readOnboarding, saveOnboarding } from './onboarding.js';
import { z } from 'zod';
import {
  Body,
  Controller,
  Get,
  Query,
  HttpException,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  startShiftSchema,
  closeShiftSchema,
  cashSchema,
  saleSchema,
  calculateLine,
  calculatePricedLine,
  toScaled,
  fromScaled,
  type Receipt,
} from '@eliza/contracts';
import { RegisterModule, RegisterService, shiftRow, type Operator } from './register.js';
import { Operations, audit } from './operations.js';
import { AccessGuard, type AuthRequest, Require, parse, hash } from './security.js';
import { AuthModule } from './auth.js';
import { Database } from './database.js';
import { consumeBatches } from './stock-batches.js';
import { resolvePrice } from './pricing-engine.js';
async function requestLock(client: PoolClient, storeId: string, id: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [storeId + id]);
}
function fingerprint(body: unknown, actor: Operator) {
  return hash(JSON.stringify({ body, employeeId: actor.employeeId, deviceId: actor.deviceId }));
}
function same(existing: { request_hash: string }, value: string) {
  if (existing.request_hash !== value)
    throw new ConflictException('This request was already used for a different operation.');
}
async function openShift(client: PoolClient, actor: Operator, id?: string) {
  const shift = (
    await client.query(
      "SELECT * FROM shifts WHERE device_id=$1 AND employee_id=$2 AND store_id=$3 AND status='open' FOR UPDATE",
      [actor.deviceId, actor.employeeId, actor.storeId],
    )
  ).rows[0];
  if (!shift || (id && shift.id !== id))
    throw new ConflictException('Start your shift before using this register.');
  return shift;
}
const posCatalogSql = `SELECT p.id,p.image,p.source,p.name,p.sku,p.category,p.category_id AS "categoryId",p.unit,p.price::text,p.regular_price::text AS "regularPrice",p.price_kind AS "priceKind",p.base_product_id AS "baseProductId",p.tax_rate::text AS "taxRate",
          COALESCE((SELECT sum(sb.quantity - COALESCE((SELECT count(*) FROM markdown_units u JOIN markdowns m ON m.id=u.markdown_id
             WHERE u.store_id=sb.store_id AND u.batch_id=sb.id AND u.status='AVAILABLE'
               AND m.cancelled_at IS NULL AND (m.valid_until IS NULL OR m.valid_until>now())),0)) FROM stock_batches sb
            WHERE sb.store_id=p.store_id AND sb.product_id=p.id
              AND (sb.expiry_date IS NULL OR sb.expiry_date>(now() AT TIME ZONE
                (SELECT timezone FROM stores WHERE id=p.store_id))::date)),0)::numeric(15,3)::text AS stock,
          COALESCE(p.plu,'') AS plu,COALESCE((SELECT jsonb_agg(b.value ORDER BY b.value) FROM barcodes b WHERE b.product_id=p.id AND b.store_id=p.store_id),'[]'::jsonb) AS barcodes FROM products p WHERE p.store_id=$1 AND p.active AND p.price IS NOT NULL`;
async function pricedCatalogRow(
  client: PoolClient,
  storeId: string,
  row: any,
  markdownUnitId?: string,
) {
  const resolved = await resolvePrice(
    client,
    storeId,
    {
      id: row.id,
      price: row.price,
      category_id: row.categoryId,
      price_kind: row.priceKind,
      regularPrice: row.regularPrice,
    },
    markdownUnitId,
  );
  return {
    ...row,
    price: resolved.price,
    regularPrice: resolved.source === 'BASE' ? row.regularPrice : resolved.basePrice,
    priceSource: resolved.source,
    promotionId: resolved.promotionId,
    ...(markdownUnitId ? { markdownUnitId, stock: '1.000' } : {}),
  };
}
const catalogFilters = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  category: z.string().max(200).default(''),
  search: z.string().max(200).default(''),
  favorites: z.enum(['true', 'false']).default('false'),
  popular: z.enum(['true', 'false']).default('false'),
});
@Controller('pos')
export class CheckoutController {
  constructor(
    private operations: Operations,
    private registers: RegisterService,
  ) {}
  @Get('onboarding') onboarding(@Req() req: Request) {
    return this.operations.transaction(async (client) =>
      readOnboarding(client, await this.registers.operator(client, req)),
    );
  }
  @Post('onboarding') saveOnboarding(@Req() req: Request, @Body() body: unknown) {
    return this.operations.transaction(async (client) =>
      saveOnboarding(client, await this.registers.operator(client, req), body),
    );
  }
  @Get('barcode-settings') barcodeSettings(@Req() req: Request) {
    return this.operations.transaction(async (client) => {
      const actor = await this.registers.operator(client, req);
      return (
        await client.query('SELECT scale_barcode AS "scaleBarcode" FROM stores WHERE id=$1', [
          actor.storeId,
        ])
      ).rows[0];
    });
  }
  @Get('products') products(
    @Req() req: Request,
    @Query('code') code?: string,
    @Query('plu') plu?: string,
  ) {
    if (code !== undefined && (typeof code !== 'string' || code.length > 200))
      throw new BadRequestException('Invalid product code.');
    if (plu !== undefined && (typeof plu !== 'string' || !/^[0-9]{1,100}$/.test(plu)))
      throw new BadRequestException('Invalid PLU.');
    return this.operations.transaction(async (client) => {
      const actor = await this.registers.operator(client, req);
      const markdownProduct = async (barcode: string) => {
        const token = (
          await client.query(
            'SELECT id,product_id FROM markdown_units WHERE store_id=$1 AND barcode=$2',
            [actor.storeId, barcode],
          )
        ).rows[0];
        if (token) {
          const product = (
            await client.query(`SELECT * FROM (${posCatalogSql}) p WHERE p.id=$2`, [
              actor.storeId,
              token.product_id,
            ])
          ).rows[0];
          if (!product) throw new ConflictException('This markdown product is unavailable.');
          try {
            return [await pricedCatalogRow(client, actor.storeId, product, token.id)];
          } catch {
            throw new ConflictException('This markdown label is no longer valid.');
          }
        }
        return null;
      };
      if (code) {
        const exactMarkdown = await markdownProduct(code);
        if (exactMarkdown) return exactMarkdown;
      }
      const rows = (
        await client.query(
          `SELECT * FROM (${posCatalogSql}) p WHERE
            ($2::text IS NULL OR p.sku=$2 OR p.plu=$2 OR p.barcodes ? $2)
            AND ($3::text IS NULL OR (p.plu ~ '^[0-9]+$' AND ltrim(p.plu,'0')=ltrim($3,'0')))
            ORDER BY p.name,p.id`,
          [actor.storeId, code ?? null, plu ?? null],
        )
      ).rows;
      // EAN-13 labels beginning with 0 can be decoded as 12-digit UPC-A codes.
      // Preserve exact product barcodes before trying the markdown alias.
      if (!rows.length && code && /^5\d{11}$/.test(code)) {
        const upcMarkdown = await markdownProduct('0' + code);
        if (upcMarkdown) return upcMarkdown;
      }
      return Promise.all(rows.map((row) => pricedCatalogRow(client, actor.storeId, row)));
    });
  }
  @Get('product-availability') productAvailability(
    @Req() req: Request,
    @Query('code') code?: string,
    @Query('plu') plu?: string,
  ) {
    if ((code === undefined) === (plu === undefined))
      throw new BadRequestException('Provide one product code.');
    if (code !== undefined && (typeof code !== 'string' || !code || code.length > 200))
      throw new BadRequestException('Invalid product code.');
    if (plu !== undefined && (typeof plu !== 'string' || !/^[0-9]{1,100}$/.test(plu)))
      throw new BadRequestException('Invalid PLU.');
    return this.operations.transaction(async (client) => {
      const actor = await this.registers.operator(client, req);
      const result = await client.query(
        `SELECT EXISTS(
          SELECT 1 FROM products p WHERE p.store_id=$1 AND NOT p.active
            AND (($2::text IS NOT NULL AND (p.sku=$2 OR p.plu=$2 OR EXISTS(
              SELECT 1 FROM barcodes b WHERE b.store_id=p.store_id AND b.product_id=p.id AND b.value=$2
            ))) OR ($3::text IS NOT NULL AND p.plu ~ '^[0-9]+$'
              AND ltrim(p.plu,'0')=ltrim($3,'0')))
        ) AS unavailable`,
        [actor.storeId, code ?? null, plu ?? null],
      );
      return result.rows[0] as { unavailable: boolean };
    });
  }
  @Get('catalog') catalog(@Req() req: Request, @Query() input: unknown) {
    const filters = parse(catalogFilters, input);
    return this.operations.transaction(async (client) => {
      const actor = await this.registers.operator(client, req);
      if (filters.search) {
        const unit = (
          await client.query(
            'SELECT id,product_id FROM markdown_units WHERE store_id=$1 AND barcode=$2',
            [actor.storeId, filters.search],
          )
        ).rows[0];
        if (unit) {
          const product = (
            await client.query(`SELECT * FROM (${posCatalogSql}) p WHERE p.id=$2`, [
              actor.storeId,
              unit.product_id,
            ])
          ).rows[0];
          if (!product) return { total: 0, categories: [], products: [], page: 1, pageSize: 20 };
          try {
            return {
              total: 1,
              categories: [product.category],
              products: [await pricedCatalogRow(client, actor.storeId, product, unit.id)],
              page: 1,
              pageSize: 20,
            };
          } catch {
            return { total: 0, categories: [], products: [], page: 1, pageSize: 20 };
          }
        }
      }
      const result = await client.query(
        `WITH available AS (
        SELECT p.*, EXISTS(SELECT 1 FROM pos_product_favorites f WHERE f.store_id=$1 AND f.employee_id=$2 AND f.product_id=p.id) AS favorite,
        CASE WHEN $6::boolean THEN COALESCE((SELECT sum(i.quantity) FROM sale_items i JOIN sales s ON s.id=i.sale_id AND s.store_id=i.store_id
          WHERE i.store_id=$1 AND i.product_id=p.id AND s.created_at>=now()-interval '30 days'),0) ELSE 0 END AS popularity
        FROM (${posCatalogSql}) p WHERE p.stock::numeric>0
          AND (p."baseProductId" IS NULL OR $5<>'' )
      ), filtered AS (
        SELECT * FROM available WHERE ($3='' OR category=$3) AND (NOT $4::boolean OR favorite)
        AND ($5='' OR name ILIKE '%'||$5||'%' OR sku ILIKE '%'||$5||'%' OR plu ILIKE '%'||$5||'%'
          OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(barcodes) b WHERE b ILIKE '%'||$5||'%'))
      ) SELECT
        (SELECT count(*) FROM filtered)::integer AS total,
        COALESCE((SELECT jsonb_agg(category ORDER BY category) FROM (SELECT DISTINCT category FROM available) c),'[]'::jsonb) AS categories,
        COALESCE((SELECT jsonb_agg(row_to_json(p)) FROM (SELECT * FROM filtered
          ORDER BY CASE WHEN $6::boolean THEN popularity END DESC,name,id LIMIT 20 OFFSET $7) p),'[]'::jsonb) AS products`,
        [
          actor.storeId,
          actor.employeeId,
          filters.category,
          filters.favorites === 'true',
          filters.search,
          filters.popular === 'true',
          (filters.page - 1) * 20,
        ],
      );
      const data = result.rows[0];
      return {
        ...data,
        products: await Promise.all(
          data.products.map((row: any) => pricedCatalogRow(client, actor.storeId, row)),
        ),
        page: filters.page,
        pageSize: 20,
      };
    });
  }
  @Post('products/:id/favorite') favorite(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
  ) {
    const body = parse(z.object({ favorite: z.boolean() }).strict(), input);
    return this.operations.transaction(async (client) => {
      const actor = await this.registers.operator(client, req);
      const product = await client.query('SELECT id FROM products WHERE id=$1 AND store_id=$2', [
        id,
        actor.storeId,
      ]);
      if (!product.rowCount) throw new NotFoundException('Product not found.');
      if (body.favorite)
        await client.query(
          'INSERT INTO pos_product_favorites(store_id,employee_id,product_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [actor.storeId, actor.employeeId, id],
        );
      else
        await client.query(
          'DELETE FROM pos_product_favorites WHERE store_id=$1 AND employee_id=$2 AND product_id=$3',
          [actor.storeId, actor.employeeId, id],
        );
      return body;
    });
  }
  @Post('shifts') start(@Body() input: unknown, @Req() req: Request) {
    const body = parse(startShiftSchema, input);
    return this.operations.transaction(async (client) => {
      const actor = await this.registers.operator(client, req);
      await requestLock(client, actor.storeId, body.requestId);
      const digest = fingerprint(body, actor);
      const existing = (
        await client.query('SELECT * FROM shifts WHERE store_id=$1 AND request_id=$2', [
          actor.storeId,
          body.requestId,
        ])
      ).rows[0];
      if (existing) {
        same(existing, digest);
        return shiftRow(client, existing.id);
      }
      // One employee cannot open concurrent shifts on different registers.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        actor.employeeId,
      ]);
      if (
        (
          await client.query(
            "SELECT id FROM shifts WHERE (device_id=$1 OR employee_id=$2) AND status='open'",
            [actor.deviceId, actor.employeeId],
          )
        ).rowCount
      )
        throw new ConflictException('This register or employee already has an open shift.');
      const shift = (
        await client.query(
          'INSERT INTO shifts(store_id,device_id,employee_id,opening_cash,request_id,request_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
          [
            actor.storeId,
            actor.deviceId,
            actor.employeeId,
            body.openingCash,
            body.requestId,
            digest,
          ],
        )
      ).rows[0];
      await client.query(
        "INSERT INTO cash_movements(store_id,shift_id,employee_id,device_id,amount,kind,reason,request_id,request_hash) VALUES($1,$2,$3,$4,$5,'opening','Opening float',$6,$7)",
        [
          actor.storeId,
          shift.id,
          actor.employeeId,
          actor.deviceId,
          body.openingCash,
          randomUUID(),
          digest,
        ],
      );
      await audit(client, actor, 'Shift opened', shift.id, { openingCash: body.openingCash });
      return shiftRow(client, shift.id);
    });
  }
  @Post('shifts/:id/close') close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    const body = parse(closeShiftSchema, input);
    return this.operations.transaction(async (client) => {
      const actor = await this.registers.operator(client, req);
      const { approval, ...payload } = body;
      const digest = fingerprint(payload, actor);
      const existing = (
        await client.query(
          'SELECT * FROM shifts WHERE id=$1 AND store_id=$2 AND device_id=$3 AND employee_id=$4 FOR UPDATE',
          [id, actor.storeId, actor.deviceId, actor.employeeId],
        )
      ).rows[0];
      if (!existing) throw new NotFoundException('Shift not found.');
      if (existing.status === 'closed') {
        if (existing.close_hash !== digest)
          throw new ConflictException('This shift is already closed.');
        return shiftRow(client, id);
      }
      const expected = (
        await client.query(
          'SELECT COALESCE(sum(amount),0)::numeric(14,2)::text AS total FROM cash_movements WHERE shift_id=$1',
          [id],
        )
      ).rows[0].total;
      const difference = toScaled(body.countedCash, 2) - toScaled(expected, 2);
      let approver = null;
      if (difference !== 0n && !actor.permissions.includes('shift.approve')) {
        if (!approval) throw new ForbiddenException('A manager must approve a cash difference.');
        const manager = await this.registers.checkPin(
          client,
          actor.deviceId,
          actor.storeId,
          approval,
          'shift.approve',
        );
        if (manager instanceof HttpException) return manager;
        approver = manager.id;
      }
      await client.query(
        "UPDATE shifts SET status='closed',expected_cash=$1,counted_cash=$2,difference=$3,closed_at=now(),notes=$4,close_request_id=$5,close_hash=$6,approver_id=$7 WHERE id=$8",
        [
          expected,
          body.countedCash,
          fromScaled(difference, 2),
          body.notes,
          body.requestId,
          digest,
          approver,
          id,
        ],
      );
      await audit(client, actor, 'Shift closed', id, {
        expectedCash: expected,
        countedCash: body.countedCash,
        difference: fromScaled(difference, 2),
        approverId: approver,
        notes: body.notes,
      });
      return shiftRow(client, id);
    });
  }
  @Post('cash') cash(@Body() input: unknown, @Req() req: Request) {
    const body = parse(cashSchema, input);
    return this.operations.transaction(async (client) => {
      const actor = await this.registers.operator(client, req);
      if (!actor.permissions.includes('cash.manage'))
        throw new ForbiddenException('A manager must record cash in or cash out.');
      await requestLock(client, actor.storeId, body.requestId);
      const digest = fingerprint(body, actor);
      const existing = (
        await client.query('SELECT * FROM cash_movements WHERE store_id=$1 AND request_id=$2', [
          actor.storeId,
          body.requestId,
        ])
      ).rows[0];
      if (existing) {
        same(existing, digest);
        return { id: existing.id };
      }
      const shift = await openShift(client, actor);
      const amount = toScaled(body.amount, 2) * (body.direction === 'out' ? -1n : 1n);
      const expected = (
        await client.query(
          'SELECT COALESCE(sum(amount),0)::numeric(14,2)::text AS total FROM cash_movements WHERE shift_id=$1',
          [shift.id],
        )
      ).rows[0].total;
      if (toScaled(expected, 2) + amount < 0n)
        throw new BadRequestException('Cash out exceeds the expected cash in the drawer.');
      const row = (
        await client.query(
          'INSERT INTO cash_movements(store_id,shift_id,employee_id,device_id,amount,kind,reason,request_id,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
          [
            actor.storeId,
            shift.id,
            actor.employeeId,
            actor.deviceId,
            fromScaled(amount, 2),
            body.direction,
            body.reason,
            body.requestId,
            digest,
          ],
        )
      ).rows[0];
      await audit(client, actor, 'Cash movement recorded', shift.id, {
        amount: fromScaled(amount, 2),
        reason: body.reason,
        movementId: row.id,
      });
      return row;
    });
  }
  @Post('sales') sale(@Body() input: unknown, @Req() req: Request) {
    const body = parse(saleSchema, input);
    return this.operations.transaction(async (client) => {
      const actor = await this.registers.operator(client, req);
      await requestLock(client, actor.storeId, body.requestId);
      const { approval, ...payload } = body;
      const digest = fingerprint(payload, actor);
      const existing = (
        await client.query(
          'SELECT request_hash,receipt FROM sales WHERE store_id=$1 AND request_id=$2',
          [actor.storeId, body.requestId],
        )
      ).rows[0];
      if (existing) {
        same(existing, digest);
        return existing.receipt;
      }
      const shift = await openShift(client, actor, body.shiftId);
      const products = (
        await client.query(
          'SELECT * FROM products WHERE store_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',
          [actor.storeId, body.lines.map((l) => l.productId)],
        )
      ).rows;
      const lines: Receipt['lines'] = [];
      const markdownBatches = new Map<string, string>();
      let subtotal = 0n,
        discount = 0n,
        tax = 0n,
        total = 0n;
      for (const item of body.lines) {
        const product = products.find((p) => p.id === item.productId);
        if (!product || !product.active)
          throw new BadRequestException('A product is no longer available. Refresh your cart.');
        if (product.price == null && !item.markdownUnitId)
          throw new ConflictException('Set a selling price before selling this product.');
        let resolved;
        try {
          resolved = await resolvePrice(client, actor.storeId, product, item.markdownUnitId);
        } catch {
          throw new ConflictException(
            `${product.name} has an invalid markdown label. Remove it from the cart.`,
          );
        }
        if (item.markdownUnitId) {
          const unit = (
            await client.query(
              `SELECT u.batch_id,u.status,m.cancelled_at,
              (m.valid_from<=now() AND (m.valid_until IS NULL OR m.valid_until>now())) AS time_valid
             FROM markdown_units u JOIN markdowns m ON m.id=u.markdown_id
             WHERE u.id=$1 AND u.store_id=$2 AND u.product_id=$3 FOR UPDATE OF u`,
              [item.markdownUnitId, actor.storeId, product.id],
            )
          ).rows[0];
          if (!unit || unit.status !== 'AVAILABLE' || unit.cancelled_at || !unit.time_valid)
            throw new ConflictException('This markdown label is no longer valid.');
          markdownBatches.set(item.markdownUnitId, unit.batch_id);
          if (item.quantity !== '1' && toScaled(item.quantity, 3) !== 1000n)
            throw new BadRequestException('A markdown label sells exactly one unit.');
        }
        if (
          toScaled(resolved.price, 2) !== toScaled(item.expectedPrice, 2) ||
          toScaled(product.tax_rate, 2) !== toScaled(item.expectedTaxRate, 2)
        )
          throw new ConflictException(
            `${product.name} has a new price or tax rate. Refresh the catalog and rebuild the affected cart line.`,
          );
        const qty = toScaled(item.quantity, 3);
        if (['piece', 'pack', 'box'].includes(product.unit) && qty % 1000n !== 0n)
          throw new BadRequestException(`${product.name} requires a whole-number quantity.`);
        if (qty > toScaled(product.stock, 3))
          throw new ConflictException(`Not enough stock for ${product.name}.`);
        const amounts = calculatePricedLine(
          resolved.price,
          resolved.source === 'BASE' ? product.regular_price : resolved.basePrice,
          item.quantity,
          product.tax_rate,
          body.discountPercent,
        );
        subtotal += toScaled(amounts.gross, 2);
        discount += toScaled(amounts.discount, 2);
        tax += toScaled(amounts.tax, 2);
        total += toScaled(amounts.total, 2);
        lines.push({
          saleItemId: randomUUID(),
          productId: product.id,
          name: product.name,
          category: product.category,
          sku: product.sku,
          unit: product.unit,
          quantity: item.quantity,
          price: resolved.price,
          taxRate: product.tax_rate,
          baseUnitPrice: resolved.basePrice,
          pricingSource: resolved.source,
          promotionId: resolved.promotionId,
          markdownUnitId: resolved.markdownUnitId,
          ...amounts,
        });
      }
      if (total > 99999999999n) throw new BadRequestException('Sale exceeds the supported total.');
      const tendered = toScaled(body.payment.tendered, 2);
      if (tendered < total) throw new BadRequestException('Payment does not cover the sale total.');
      if (body.payment.method === 'card' && tendered !== total)
        throw new BadRequestException('The recorded card amount must equal the total.');
      let approverName: string | null = null,
        approverId: string | null = null;
      if (
        toScaled(body.discountPercent, 2) > 1000n &&
        !actor.permissions.includes('discount.approve')
      ) {
        if (!approval)
          throw new ForbiddenException('Discounts above 10% require manager approval.');
        const manager = await this.registers.checkPin(
          client,
          actor.deviceId,
          actor.storeId,
          approval,
          'discount.approve',
        );
        if (manager instanceof HttpException) return manager;
        approverName = manager.name;
        approverId = manager.id;
      }
      const receiptId = randomUUID();
      const sequence = (await client.query("SELECT nextval('receipt_sequence')::text AS n")).rows[0]
        .n;
      const profile = (
        await client.query(
          'SELECT name,address,phone,business_number,receipt_footer FROM stores WHERE id=$1',
          [actor.storeId],
        )
      ).rows[0];
      const receipt: Receipt = {
        id: receiptId,
        receiptNumber: `E-${sequence.padStart(7, '0')}`,
        createdAt: new Date().toISOString(),
        storeName: profile.name,
        storeAddress: profile.address,
        storePhone: profile.phone,
        businessNumber: profile.business_number,
        receiptFooter: profile.receipt_footer,
        currency: actor.currency,
        timezone: actor.timezone,
        cashierName: actor.name,
        deviceName: actor.deviceName,
        shiftId: shift.id,
        lines,
        subtotal: fromScaled(subtotal, 2),
        discount: fromScaled(discount, 2),
        tax: fromScaled(tax, 2),
        total: fromScaled(total, 2),
        discountPercent: body.discountPercent,
        payment: {
          method: body.payment.method,
          tendered: body.payment.tendered,
          change: fromScaled(tendered - total, 2),
        },
        approverName,
      };
      await client.query(
        'INSERT INTO sales(id,store_id,device_id,employee_id,shift_id,request_id,request_hash,receipt_number,total,tax,discount,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          receiptId,
          actor.storeId,
          actor.deviceId,
          actor.employeeId,
          shift.id,
          body.requestId,
          digest,
          receipt.receiptNumber,
          receipt.total,
          receipt.tax,
          receipt.discount,
          JSON.stringify(receipt),
        ],
      );
      const remainingStock = new Map<string, bigint>();
      for (const line of lines) {
        const product = products.find((p) => p.id === line.productId)!;
        const previous = remainingStock.get(product.id) ?? toScaled(product.stock, 3);
        const next = previous - toScaled(line.quantity, 3);
        if (next < 0n) throw new ConflictException(`Not enough stock for ${product.name}.`);
        remainingStock.set(product.id, next);
        const balance = fromScaled(next, 3);
        const saleItemId = line.saleItemId!;
        const costTotal = await consumeBatches(client, actor.storeId, product.id, line.quantity, {
          saleItemId,
          markdownBatchId: line.markdownUnitId
            ? markdownBatches.get(line.markdownUnitId)
            : undefined,
        });
        await client.query(
          'INSERT INTO sale_items(id,store_id,sale_id,product_id,quantity,price,cost,tax_rate,total,cost_total,base_unit_price,pricing_source,promotion_id,markdown_unit_id,discount_total) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
          [
            saleItemId,
            actor.storeId,
            receiptId,
            product.id,
            line.quantity,
            line.price,
            fromScaled(
              (toScaled(costTotal, 2) * 1000n + toScaled(line.quantity, 3) / 2n) /
                toScaled(line.quantity, 3),
              2,
            ),
            line.taxRate,
            line.total,
            costTotal,
            line.baseUnitPrice ?? line.price,
            line.pricingSource ?? 'BASE',
            line.promotionId ?? null,
            line.markdownUnitId ?? null,
            line.discount,
          ],
        );
        if (line.markdownUnitId) {
          const redeemed = await client.query(
            `UPDATE markdown_units SET status='SOLD',sold_at=now(),sale_item_id=$2
           WHERE id=$1 AND store_id=$3 AND status='AVAILABLE'`,
            [line.markdownUnitId, saleItemId, actor.storeId],
          );
          if (redeemed.rowCount !== 1)
            throw new ConflictException('This markdown label was already used.');
        }
        await client.query('UPDATE products SET stock=$1 WHERE id=$2', [balance, product.id]);
        await client.query(
          "INSERT INTO movements(store_id,product_id,employee_id,device_id,quantity,balance,reason,notes,request_id,request_hash,sale_id,shift_id) VALUES($1,$2,$3,$4,$5,$6,'sale',$7,$8,$9,$10,$11)",
          [
            actor.storeId,
            product.id,
            actor.employeeId,
            actor.deviceId,
            fromScaled(-toScaled(line.quantity, 3), 3),
            balance,
            receipt.receiptNumber,
            randomUUID(),
            digest,
            receiptId,
            shift.id,
          ],
        );
      }
      await client.query(
        'INSERT INTO payments(store_id,sale_id,method,amount,tendered,change) VALUES($1,$2,$3,$4,$5,$6)',
        [
          actor.storeId,
          receiptId,
          body.payment.method,
          receipt.total,
          body.payment.tendered,
          receipt.payment.change,
        ],
      );
      if (body.payment.method === 'cash')
        await client.query(
          "INSERT INTO cash_movements(store_id,shift_id,employee_id,device_id,amount,kind,reason,request_id,request_hash,sale_id) VALUES($1,$2,$3,$4,$5,'sale',$6,$7,$8,$9)",
          [
            actor.storeId,
            shift.id,
            actor.employeeId,
            actor.deviceId,
            receipt.total,
            receipt.receiptNumber,
            randomUUID(),
            digest,
            receiptId,
          ],
        );
      await audit(client, actor, 'Sale completed', receiptId, {
        receiptNumber: receipt.receiptNumber,
        total: receipt.total,
        discount: receipt.discount,
        approverId,
        paymentMethod: body.payment.method,
        shiftId: shift.id,
      });
      return receipt;
    });
  }
  @Get('sales') recent(@Req() req: Request) {
    return this.operations.transaction(async (client) => {
      const actor = await this.registers.operator(client, req);
      return (
        await client.query(
          'SELECT receipt FROM sales WHERE store_id=$1 AND employee_id=$2 AND device_id=$3 ORDER BY created_at DESC LIMIT 20',
          [actor.storeId, actor.employeeId, actor.deviceId],
        )
      ).rows.map((r) => r.receipt);
    });
  }
  @Post('sales/:id/reprint') reprint(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.operations.transaction(async (client) => {
      const actor = await this.registers.operator(client, req);
      const sale = (
        await client.query(
          'SELECT receipt FROM sales WHERE id=$1 AND store_id=$2 AND employee_id=$3 AND device_id=$4',
          [id, actor.storeId, actor.employeeId, actor.deviceId],
        )
      ).rows[0];
      if (!sale) throw new NotFoundException('Receipt not found.');
      await audit(client, actor, 'Receipt reprinted', id, {});
      return sale.receipt;
    });
  }
}
@Controller('reports')
@UseGuards(AccessGuard)
export class SalesReportsController {
  constructor(
    private operations: Operations,
    private database: Database,
  ) {}
  @Get('sales') @Require('sales.read') async sales(
    @Req() req: AuthRequest,
    @Query('page') pageInput?: string,
  ) {
    const page = parse(z.coerce.number().int().min(1).max(1000000).default(1), pageInput);
    const pageSize = pageInput === undefined ? 100 : 50;
    const result = await this.database.pool.query(
      `WITH matching AS (SELECT id,created_at,receipt FROM sales WHERE store_id=$1),
       paged AS (SELECT receipt FROM matching ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3)
       SELECT (SELECT count(*)::int FROM matching) AS total,
              COALESCE((SELECT json_agg(receipt) FROM paged),'[]'::json) AS rows`,
      [req.context.store.id, pageSize, (page - 1) * pageSize],
    );
    const { rows, total } = result.rows[0];
    return pageInput === undefined ? rows : { rows, total, page, pageSize };
  }
  @Post('sales/:id/reprint') @Require('sales.read') reprint(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.operations.transaction(async (client) => {
      const receipt = (
        await client.query('SELECT receipt FROM sales WHERE id=$1 AND store_id=$2', [
          id,
          req.context.store.id,
        ])
      ).rows[0];
      if (!receipt) throw new NotFoundException('Receipt not found.');
      await audit(
        client,
        {
          storeId: req.context.store.id,
          employeeId: req.context.user.id,
          deviceId: req.context.device.id,
        },
        'Receipt reprinted',
        id,
        {},
      );
      return { ok: true };
    });
  }
  @Get('shifts') @Require('sales.read') shifts(@Req() req: AuthRequest) {
    return this.operations.transaction(async (client) => {
      const rows = (
        await client.query(
          'SELECT id FROM shifts WHERE store_id=$1 ORDER BY opened_at DESC LIMIT 100',
          [req.context.store.id],
        )
      ).rows;
      return Promise.all(rows.map((r) => shiftRow(client, r.id)));
    });
  }
  @Get('shifts/:id/cash') @Require('sales.read') async cash(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return (
      await this.database.pool.query(
        `SELECT c.id,c.amount,c.kind,c.reason,c.created_at AS "createdAt",e.name AS actor FROM cash_movements c JOIN employees e ON e.id=c.employee_id WHERE c.shift_id=$1 AND c.store_id=$2 ORDER BY c.created_at`,
        [id, req.context.store.id],
      )
    ).rows;
  }
}
@Module({
  imports: [RegisterModule, AuthModule],
  controllers: [CheckoutController, SalesReportsController],
})
export class CheckoutModule {}
