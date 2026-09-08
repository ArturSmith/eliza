import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { and, eq, asc } from 'drizzle-orm';
import { productSchema } from '@eliza/contracts';
import { z } from 'zod';
import { Database } from './database.js';
import { AccessGuard, type AuthRequest, parse, Require } from './security.js';
import { AuthModule } from './auth.js';
import { products, barcodes, audits } from './schema.js';
@Controller('products')
@UseGuards(AccessGuard)
export class CatalogController {
  constructor(private database: Database) {}
  @Get() @Require('catalog.read') async list(@Req() req: AuthRequest) {
    const rows = await this.database.db
      .select()
      .from(products)
      .where(eq(products.storeId, req.context.store.id))
      .orderBy(asc(products.name));
    const codes = await this.database.db
      .select()
      .from(barcodes)
      .where(eq(barcodes.storeId, req.context.store.id));
    return rows.map((p) => ({
      ...p,
      cost: req.context.user.permissions.includes('costs.read') ? p.cost : null,
      plu: p.plu ?? '',
      barcodes: codes.filter((b) => b.productId === p.id).map((b) => b.value),
    }));
  }
  @Post() @Require('catalog.write') async create(@Body() input: unknown, @Req() req: AuthRequest) {
    const { barcodes: values, plu, ...body } = parse(productSchema, input);
    const { store, user, device } = req.context;
    return this.database.db.transaction(async (tx) => {
      const [product] = await tx
        .insert(products)
        .values({ ...body, plu: plu || null, storeId: store.id })
        .returning();
      if (values.length)
        await tx
          .insert(barcodes)
          .values(values.map((value) => ({ value, productId: product.id, storeId: store.id })));
      await tx.insert(audits).values({
        storeId: store.id,
        employeeId: user.id,
        deviceId: device.id,
        action: 'Product created',
        entityId: product.id,
        details: { ...body, plu, barcodes: values },
      });
      return { ...product, plu: plu ?? '', barcodes: values };
    });
  }

  @Patch(':id') @Require('catalog.write') async edit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const { barcodes: values, plu, ...body } = parse(productSchema, input);
    const { store, user, device } = req.context;
    return this.database.db.transaction(async (tx) => {
      const [old] = await tx
        .select()
        .from(products)
        .where(and(eq(products.id, id), eq(products.storeId, store.id)))
        .for('update');
      if (!old) throw new NotFoundException('Product not found.');
      if (old.unit !== body.unit)
        throw new BadRequestException(
          'Unit changes require a stock conversion workflow. Create a separate product instead.',
        );
      const previousCodes = await tx
        .select({ value: barcodes.value })
        .from(barcodes)
        .where(eq(barcodes.productId, id));
      const [product] = await tx
        .update(products)
        .set({ ...body, plu: plu || null })
        .where(eq(products.id, id))
        .returning();
      await tx
        .delete(barcodes)
        .where(and(eq(barcodes.productId, id), eq(barcodes.storeId, store.id)));
      if (values.length)
        await tx
          .insert(barcodes)
          .values(values.map((value) => ({ value, productId: id, storeId: store.id })));
      await tx.insert(audits).values({
        storeId: store.id,
        employeeId: user.id,
        deviceId: device.id,
        action: 'Product updated',
        entityId: id,
        details: {
          before: { ...old, barcodes: previousCodes.map((b) => b.value) },
          after: { ...body, plu, barcodes: values },
        },
      });
      return { ...product, plu: plu ?? '', barcodes: values };
    });
  }
  @Patch(':id/status') @Require('catalog.write') async status(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const { active } = parse(z.object({ active: z.boolean() }), input);
    const { store, user, device } = req.context;
    return this.database.db.transaction(async (tx) => {
      const [previous] = await tx
        .select()
        .from(products)
        .where(and(eq(products.id, id), eq(products.storeId, store.id)))
        .for('update');
      if (!previous) throw new NotFoundException('Product not found.');
      const [product] = await tx
        .update(products)
        .set({ active })
        .where(eq(products.id, id))
        .returning();
      if (previous.active !== active)
        await tx.insert(audits).values({
          storeId: store.id,
          employeeId: user.id,
          deviceId: device.id,
          action: active ? 'Product activated' : 'Product deactivated',
          entityId: id,
          details: { before: previous.active, after: active },
        });
      return product;
    });
  }
}
@Module({ imports: [AuthModule], controllers: [CatalogController] })
export class CatalogModule {}
