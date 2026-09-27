import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Query,
  UseGuards,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  type ShoppingList,
  supplierSchema,
  supplierProductSchema,
  compareOffers,
  unitCost,
  shoppingListCreateSchema,
  shoppingListSaveSchema,
  shoppingListConvertSchema,
  suggestedOrderQuantity,
  initialReorderTarget,
  purchasePaymentSchema,
  purchaseDraftSchema,
  extractionRequestSchema,
  receiptInputSchema,
  calculatePurchaseLine,
  toScaled,
  fromScaled,
} from '@eliza/contracts';
import { Database } from './database.js';
import { AuthModule } from './auth.js';
import { AccessGuard, Require, parse, hash, cookie, type AuthRequest } from './security.js';
import { Operations, audit } from './operations.js';
import type { PoolClient } from 'pg';
import { shoppingProducts } from './shopping-list-data.js';
import { answerPurchaseDocumentQuestion, extractPurchaseDocument } from './purchase-extraction.js';
const command = z.object({ requestId: z.uuid(), version: z.number().int().positive() });
const supplierColumns = `id,code,name,contact_name AS "contactName",contact_phone AS "contactPhone",email,phone,address,company_number AS "companyNumber",payment_terms AS "paymentTerms",notes,tags,active,version,created_at AS "createdAt"`;
@Controller()
@UseGuards(AccessGuard)
export class PurchasingController {
  constructor(
    private database: Database,
    private operations: Operations,
  ) {}
  private async run(
    req: AuthRequest,
    requestId: string,
    action: string,
    body: unknown,
    work: (c: PoolClient) => Promise<unknown>,
  ) {
    const { store, user, device } = req.context;
    const signature = hash(JSON.stringify({ action, body, employee: user.id, device: device.id }));
    return this.operations.transaction(async (c) => {
      const permission =
        action === 'supplier'
          ? 'suppliers.manage'
          : action === 'receive'
            ? 'purchases.receive'
            : 'purchases.write';
      const actor = (
        await c.query(
          "SELECT (SELECT COALESCE(jsonb_agg(DISTINCT p.value),'[]'::jsonb) FROM employee_roles er JOIN roles rr ON rr.id=er.role_id AND rr.store_id=er.store_id CROSS JOIN LATERAL jsonb_array_elements_text(rr.permissions) p(value) WHERE er.employee_id=e.id AND er.store_id=e.store_id) AS permissions FROM sessions s JOIN employees e ON e.id=s.employee_id JOIN devices d ON d.id=s.device_id JOIN roles r ON r.id=e.role_id WHERE s.token_hash=$1 AND s.expires_at>now() AND e.active AND d.active AND e.id=$2 AND d.id=$3 AND e.store_id=$4 AND d.store_id=$4 AND r.store_id=$4 FOR SHARE OF s,e,d,r",
          [hash(cookie(req, 'eliza_session')), user.id, device.id, store.id],
        )
      ).rows[0];
      if (!actor?.permissions.includes(permission))
        throw new ForbiddenException('Your access changed. Sign in again.');
      req.context.user.permissions = actor.permissions;
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [store.id + requestId]);
      const old = (
        await c.query(
          'SELECT request_hash,result FROM purchasing_commands WHERE store_id=$1 AND request_id=$2',
          [store.id, requestId],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== signature)
          throw new ConflictException('This request was already used for another change.');
        return old.result;
      }
      const result = await work(c);
      await c.query(
        'INSERT INTO purchasing_commands(store_id,request_id,action,request_hash,result,employee_id,device_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [store.id, requestId, action, signature, JSON.stringify(result), user.id, device.id],
      );
      return result;
    });
  }

  @Get('shopping-lists') @Require('purchases.read') async shoppingLists(@Req() req: AuthRequest) {
    return (
      await this.database.pool.query(
        `SELECT s.id,s.name,s.notes,s.version,s.created_at AS "createdAt",
      (SELECT count(*)::int FROM shopping_list_lines l WHERE l.list_id=s.id) AS "productCount",
      (SELECT count(*)::int FROM shopping_list_lines l WHERE l.list_id=s.id AND l.purchase_id IS NOT NULL) AS "convertedCount"
      FROM shopping_lists s WHERE s.store_id=$1 ORDER BY s.created_at DESC LIMIT 100`,
        [req.context.store.id],
      )
    ).rows;
  }
  @Get('shopping-lists/products') @Require('purchases.read') async shoppingCatalog(
    @Req() req: AuthRequest,
  ) {
    const c = await this.database.pool.connect();
    try {
      return await shoppingProducts(c, req.context.store.id);
    } finally {
      c.release();
    }
  }
  private async shoppingDetail(c: PoolClient, id: string, store: string): Promise<ShoppingList> {
    const list = (
      await c.query(
        'SELECT id,name,notes,sections,version,created_at AS "createdAt" FROM shopping_lists WHERE id=$1 AND store_id=$2',
        [id, store],
      )
    ).rows[0];
    if (!list) throw new NotFoundException('Shopping list not found.');
    const lines = (
      await c.query(
        `SELECT l.id,l.section_id AS "sectionId",l.product_id AS "productId",l.label,l.target_stock AS target,
      l.quantity,l.unit_cost AS "unitCost",l.tax_rate AS "taxRate",l.supplier_id AS "supplierId",l.notes,
      l.purchase_id AS "purchaseId",s.name AS "supplierName",s.active AS "supplierActive",
      p.number AS "purchaseNumber",p.status AS "purchaseStatus"
      FROM shopping_list_lines l LEFT JOIN suppliers s ON s.id=l.supplier_id
      LEFT JOIN purchases p ON p.id=l.purchase_id WHERE l.list_id=$1 ORDER BY l.position,l.id`,
        [id],
      )
    ).rows;
    const products = new Map(
      (
        await shoppingProducts(
          c,
          store,
          lines.map((l) => l.productId).filter((productId) => productId !== null),
        )
      ).map((p) => [p.productId, p]),
    );
    return {
      ...list,
      lines: lines.map((line) =>
        line.productId
          ? { ...products.get(line.productId), ...line }
          : {
              name: line.label,
              sku: '',
              unit: 'piece',
              active: true,
              stock: '0',
              minStock: '0',
              incoming: '0',
              drafts: '0',
              ...line,
            },
      ),
    };
  }
  @Get('shopping-lists/:id') @Require('purchases.read') async getShoppingList(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    const c = await this.database.pool.connect();
    try {
      return await this.shoppingDetail(c, id, req.context.store.id);
    } finally {
      c.release();
    }
  }
  private async lockShopping(c: PoolClient, id: string, store: string, version: number) {
    const row = (
      await c.query('SELECT * FROM shopping_lists WHERE id=$1 AND store_id=$2 FOR UPDATE', [
        id,
        store,
      ])
    ).rows[0];
    if (!row) throw new NotFoundException('Shopping list not found.');
    if (row.version !== version)
      throw new ConflictException('Shopping list changed. Reload it before continuing.');
    return row;
  }
  @Post('shopping-lists') @Require('purchases.write') async createShoppingList(
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(shoppingListCreateSchema, input);
    return this.run(req, b.requestId, 'shopping-create', b, async (c) => {
      const store = req.context.store.id;
      const products = (await shoppingProducts(c, store)).filter(
        (p) => p.active && toScaled(p.stock, 3) <= toScaled(p.minStock, 3),
      );
      if (products.length > 500)
        throw new BadRequestException('A shopping list supports up to 500 products.');
      const list = (
        await c.query(
          'INSERT INTO shopping_lists(store_id,name,notes) VALUES($1,$2,$3) RETURNING id',
          [store, b.name, b.notes],
        )
      ).rows[0];
      for (const [index, p] of products.entries()) {
        const target = p.preferredTarget ?? initialReorderTarget(p.minStock, p.unit);
        const quantity = suggestedOrderQuantity(target, p.stock, p.incoming, p.drafts, p.unit);
        await c.query(
          'INSERT INTO shopping_list_lines(store_id,list_id,product_id,target_stock,quantity,unit_cost,tax_rate,supplier_id,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            store,
            list.id,
            p.productId,
            target,
            quantity,
            p.unitCost,
            p.taxRate,
            p.preferredSupplierId,
            index,
          ],
        );
      }
      await audit(
        c,
        { storeId: store, employeeId: req.context.user.id, deviceId: req.context.device.id },
        'Shopping list created',
        list.id,
        { products: products.length },
      );
      return this.shoppingDetail(c, list.id, store);
    });
  }
  @Post('shopping-lists/:id') @Require('purchases.write') async saveShoppingList(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(shoppingListSaveSchema, input);
    return this.run(req, b.requestId, 'shopping-save', { id, ...b }, async (c) => {
      const store = req.context.store.id;
      await this.lockShopping(c, id, store, b.version);
      const old = await this.shoppingDetail(c, id, store);
      const sectionIds = new Set(b.sections.map((section) => section.id));
      if (b.lines.some((line) => line.sectionId && !sectionIds.has(line.sectionId)))
        throw new BadRequestException('Choose a section from this shopping list.');
      await c.query(
        'UPDATE shopping_list_lines SET section_id=NULL WHERE list_id=$1 AND section_id IS NOT NULL AND NOT (section_id=ANY($2::uuid[]))',
        [id, [...sectionIds]],
      );
      const converted = new Set(
        old.lines.filter((l) => l.purchaseId && l.productId).map((l) => l.productId),
      );
      if (b.lines.length + converted.size > 500)
        throw new BadRequestException('A shopping list supports up to 500 products.');
      await c.query('DELETE FROM shopping_list_lines WHERE list_id=$1 AND purchase_id IS NULL', [
        id,
      ]);
      for (const [index, line] of b.lines.entries()) {
        if (line.productId === null) {
          await c.query(
            'INSERT INTO shopping_list_lines(store_id,list_id,label,target_stock,quantity,unit_cost,tax_rate,supplier_id,notes,position,section_id) VALUES($1,$2,$3,0,$4,0,0,NULL,$5,$6,$7)',
            [store, id, line.label, line.quantity, line.notes, index, line.sectionId],
          );
          continue;
        }
        if (converted.has(line.productId))
          throw new ConflictException(
            'Converted items cannot be changed or ordered again from this list.',
          );
        const p = (
          await c.query(
            'SELECT unit FROM products WHERE id=$1 AND store_id=$2 AND active FOR SHARE',
            [line.productId, store],
          )
        ).rows[0];
        if (!p) throw new BadRequestException('Choose active products from this store.');
        this.whole(p.unit, line.target);
        this.whole(p.unit, line.quantity);
        if (
          line.supplierId &&
          !(
            await c.query(
              'SELECT id FROM suppliers WHERE id=$1 AND store_id=$2 AND active FOR SHARE',
              [line.supplierId, store],
            )
          ).rowCount
        )
          throw new BadRequestException('Choose an active supplier.');
        await c.query(
          'INSERT INTO shopping_list_lines(store_id,list_id,product_id,target_stock,quantity,unit_cost,tax_rate,supplier_id,notes,position,section_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            store,
            id,
            line.productId,
            line.target,
            line.quantity,
            line.unitCost,
            line.taxRate,
            line.supplierId,
            line.notes,
            index,
            line.sectionId,
          ],
        );
        await c.query(
          `INSERT INTO reorder_preferences(product_id,store_id,target_stock,supplier_id) VALUES($1,$2,$3,$4)
          ON CONFLICT(product_id) DO UPDATE SET target_stock=EXCLUDED.target_stock,supplier_id=EXCLUDED.supplier_id`,
          [line.productId, store, line.target, line.supplierId],
        );
      }
      await c.query(
        'UPDATE shopping_lists SET name=$2,notes=$3,sections=$4::jsonb,version=version+1 WHERE id=$1',
        [id, b.name, b.notes, JSON.stringify(b.sections)],
      );
      await audit(
        c,
        { storeId: store, employeeId: req.context.user.id, deviceId: req.context.device.id },
        'Shopping list saved',
        id,
        { lines: b.lines },
      );
      return this.shoppingDetail(c, id, store);
    });
  }
  @Post('shopping-lists/:id/convert') @Require('purchases.write') async convertShoppingList(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(shoppingListConvertSchema, input);
    return this.run(req, b.requestId, 'shopping-convert', { id, ...b }, async (c) => {
      const store = req.context.store.id;
      const list = await this.lockShopping(c, id, store, b.version);
      const detail = await this.shoppingDetail(c, id, store);
      const groups = new Map<string, typeof detail.lines>();
      for (const lineId of b.lineIds) {
        const line = detail.lines.find((l) => l.id === lineId);
        if (!line || line.purchaseId)
          throw new ConflictException(
            'Converted items cannot be changed or ordered again from this list.',
          );
        if (!line.supplierId || !line.productId || toScaled(line.quantity, 3) <= 0n)
          throw new BadRequestException(
            'Choose a supplier and a positive quantity for every selected item.',
          );
        const rows = groups.get(line.supplierId) ?? [];
        rows.push(line);
        groups.set(line.supplierId, rows);
      }
      for (const [supplierId, lines] of [...groups.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (let offset = 0; offset < lines.length; offset += 100) {
          const batch = lines.slice(offset, offset + 100);
          const order = await this.saveDraft(
            c,
            req,
            purchaseDraftSchema.parse({
              supplierId,
              notes: ('Shopping list: ' + list.name + '\n' + list.notes).slice(0, 1000),
              lines: batch.map((l) => ({
                productId: l.productId,
                quantity: l.quantity,
                unitCost: l.unitCost,
                taxRate: l.taxRate,
              })),
            }),
          );
          await c.query(
            'UPDATE shopping_list_lines SET purchase_id=$1 WHERE list_id=$2 AND id=ANY($3::uuid[])',
            [order.id, id, batch.map((l) => l.id)],
          );
        }
      }
      await c.query('UPDATE shopping_lists SET version=version+1 WHERE id=$1', [id]);
      await audit(
        c,
        { storeId: store, employeeId: req.context.user.id, deviceId: req.context.device.id },
        'Shopping list converted',
        id,
        { lineIds: b.lineIds },
      );
      return this.shoppingDetail(c, id, store);
    });
  }
  @Post('shopping-lists/:id/delete') @Require('purchases.write') async deleteShoppingList(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(command, input);
    return this.run(req, b.requestId, 'shopping-delete', { id, ...b }, async (c) => {
      const store = req.context.store.id;
      await this.lockShopping(c, id, store, b.version);
      await c.query('DELETE FROM shopping_list_lines WHERE list_id=$1', [id]);
      await c.query('DELETE FROM shopping_lists WHERE id=$1 AND store_id=$2', [id, store]);
      await audit(
        c,
        { storeId: store, employeeId: req.context.user.id, deviceId: req.context.device.id },
        'Shopping list deleted',
        id,
        {},
      );
      return { id };
    });
  }

  @Get('suppliers') @Require('suppliers.read') async suppliers(@Req() req: AuthRequest) {
    return (
      await this.database.pool.query(
        `SELECT ${supplierColumns} FROM suppliers WHERE store_id=$1 ORDER BY name`,
        [req.context.store.id],
      )
    ).rows;
  }
  @Post('suppliers') @Require('suppliers.manage') async supplier(
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(
      supplierSchema.extend({
        requestId: z.uuid(),
        id: z.uuid().optional(),
        version: z.number().int().positive().optional(),
        active: z.boolean().default(true),
      }),
      input,
    );
    return this.run(req, b.requestId, 'supplier', b, async (c) => {
      const values = [
        req.context.store.id,
        b.code,
        b.name,
        b.contactName,
        b.contactPhone,
        b.email,
        b.phone,
        b.address,
        b.companyNumber,
        b.paymentTerms,
        b.notes,
        b.active,
        b.id && !Object.prototype.hasOwnProperty.call(input, 'tags')
          ? null
          : JSON.stringify(b.tags),
      ];
      let row;
      if (b.id) {
        row = (
          await c.query(
            `UPDATE suppliers SET code=$2,name=$3,contact_name=$4,contact_phone=$5,email=$6,phone=$7,address=$8,company_number=$9,payment_terms=$10,notes=$11,active=$12,tags=COALESCE($13::jsonb,tags),version=version+1 WHERE store_id=$1 AND id=$14 AND version=$15 RETURNING ${supplierColumns}`,
            [...values, b.id, b.version],
          )
        ).rows[0];
        if (!row) throw new ConflictException('Supplier changed. Refresh and try again.');
      } else
        row = (
          await c.query(
            `INSERT INTO suppliers(store_id,code,name,contact_name,contact_phone,email,phone,address,company_number,payment_terms,notes,active,tags) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) RETURNING ${supplierColumns}`,
            values,
          )
        ).rows[0];
      await audit(
        c,
        {
          storeId: req.context.store.id,
          employeeId: req.context.user.id,
          deviceId: req.context.device.id,
        },
        b.id ? 'Supplier updated' : 'Supplier created',
        row.id,
        { code: b.code, name: b.name, active: b.active },
      );
      return row;
    });
  }

  @Delete('suppliers/:id') @Require('suppliers.manage') async deleteSupplier(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    try {
      return await this.run(req, randomUUID(), 'supplier', { id, delete: true }, async (c) => {
        const supplier = (
          await c.query('SELECT code,name FROM suppliers WHERE id=$1 AND store_id=$2 FOR UPDATE', [
            id,
            req.context.store.id,
          ])
        ).rows[0];
        if (!supplier) throw new NotFoundException('Supplier not found.');
        await c.query('DELETE FROM suppliers WHERE id=$1 AND store_id=$2', [
          id,
          req.context.store.id,
        ]);
        await audit(
          c,
          {
            storeId: req.context.store.id,
            employeeId: req.context.user.id,
            deviceId: req.context.device.id,
          },
          'Supplier deleted',
          id,
          { code: supplier.code, name: supplier.name },
        );
        return { deleted: true };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23503')
        throw new ConflictException(
          'This supplier is used by purchases, product offers or shopping lists. Deactivate it instead.',
        );
      throw error;
    }
  }

  // Quoted offers joined with what each supplier was actually last paid, so the
  // manager can see whether a quote is still being honoured.
  private offerQuery(where: string) {
    return `SELECT sp.id,sp.supplier_id AS "supplierId",s.name AS "supplierName",
      sp.product_id AS "productId",p.name AS "productName",p.sku,p.unit,
      sp.supplier_sku AS "supplierSku",sp.pack_size::text AS "packSize",sp.pack_cost::text AS "packCost",
      sp.lead_time_days AS "leadTimeDays",sp.minimum_order::text AS "minimumOrder",
      sp.notes,sp.active,sp.version,
      h.unit_cost::text AS "lastPaidCost",h.created_at AS "lastDeliveredAt",h.deliveries
      FROM supplier_products sp
      JOIN suppliers s ON s.id=sp.supplier_id
      JOIN products p ON p.id=sp.product_id
      LEFT JOIN LATERAL (
        SELECT l.unit_cost,r.created_at,count(*) OVER () ::int AS deliveries
        FROM goods_receipt_lines l
        JOIN goods_receipts r ON r.id=l.receipt_id AND r.store_id=l.store_id
        JOIN purchases pu ON pu.id=r.purchase_id AND pu.store_id=r.store_id
        WHERE l.product_id=sp.product_id AND pu.supplier_id=sp.supplier_id AND l.store_id=sp.store_id
        ORDER BY r.created_at DESC LIMIT 1
      ) h ON true
      WHERE sp.store_id=$1 AND ${where}`;
  }
  @Get('suppliers/:id/products') @Require('suppliers.read') async supplierCatalog(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    const rows = (
      await this.database.pool.query(this.offerQuery('sp.supplier_id=$2') + ' ORDER BY p.name', [
        req.context.store.id,
        id,
      ])
    ).rows;
    // Ranking across a supplier's own catalogue would be meaningless, but every
    // row still needs its per-unit price, so the client never has to derive it.
    return rows.map((row) => ({
      ...row,
      unitCost: unitCost(row.packCost, row.packSize),
      cheapest: false,
      premiumPercent: null,
    }));
  }
  @Get('products/:id/suppliers') @Require('suppliers.read') async productOffers(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    const rows = (
      await this.database.pool.query(this.offerQuery('sp.product_id=$2'), [
        req.context.store.id,
        id,
      ])
    ).rows;
    // Ranking lives in contracts so the API and the UI cannot disagree on which
    // supplier is cheapest.
    return compareOffers(rows);
  }
  // Every offer in the store, ranked per product. The shopping list needs offers
  // for many products at once; fetching them per line would issue one request
  // per row.
  @Get('supplier-products') @Require('suppliers.read') async allOffers(@Req() req: AuthRequest) {
    const rows = (
      await this.database.pool.query(this.offerQuery('sp.active'), [req.context.store.id])
    ).rows;
    const byProduct = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byProduct.get(row.productId);
      if (list) list.push(row);
      else byProduct.set(row.productId, [row]);
    }
    return [...byProduct.values()].flatMap((offers) => compareOffers(offers));
  }
  @Post('supplier-products') @Require('suppliers.manage') async saveOffer(
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(
      supplierProductSchema.extend({
        requestId: z.uuid(),
        id: z.uuid().optional(),
        version: z.number().int().positive().optional(),
      }),
      input,
    );
    return this.run(req, b.requestId, 'supplier', b, async (c) => {
      const store = req.context.store.id;
      const values = [
        store,
        b.supplierId,
        b.productId,
        b.supplierSku,
        b.packSize,
        b.packCost,
        b.leadTimeDays,
        b.minimumOrder,
        b.notes,
        b.active,
      ];
      let row;
      if (b.id) {
        row = (
          await c.query(
            `UPDATE supplier_products SET supplier_id=$2,product_id=$3,supplier_sku=$4,pack_size=$5,pack_cost=$6,
             lead_time_days=$7,minimum_order=$8,notes=$9,active=$10,version=version+1,updated_at=now()
             WHERE store_id=$1 AND id=$11 AND version=$12 RETURNING id,pack_size,pack_cost`,
            [...values, b.id, b.version],
          )
        ).rows[0];
        if (!row)
          throw new ConflictException('This supplier price changed. Refresh and try again.');
      } else {
        row = (
          await c.query(
            `INSERT INTO supplier_products(store_id,supplier_id,product_id,supplier_sku,pack_size,pack_cost,lead_time_days,minimum_order,notes,active)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT(supplier_id,product_id) DO UPDATE SET
               supplier_sku=EXCLUDED.supplier_sku,pack_size=EXCLUDED.pack_size,pack_cost=EXCLUDED.pack_cost,
               lead_time_days=EXCLUDED.lead_time_days,minimum_order=EXCLUDED.minimum_order,
               notes=EXCLUDED.notes,active=EXCLUDED.active,version=supplier_products.version+1,updated_at=now()
             RETURNING id,pack_size,pack_cost`,
            values,
          )
        ).rows[0];
      }
      // Only record history when the quote actually moved, so the trend is not
      // buried under no-op edits to unrelated fields.
      const changed = (
        await c.query(
          `SELECT 1 FROM supplier_price_history WHERE supplier_product_id=$1
           AND pack_size=$2 AND pack_cost=$3
           ORDER BY recorded_at DESC LIMIT 1`,
          [row.id, b.packSize, b.packCost],
        )
      ).rowCount;
      if (!changed)
        await c.query(
          'INSERT INTO supplier_price_history(store_id,supplier_product_id,pack_size,pack_cost,employee_id) VALUES($1,$2,$3,$4,$5)',
          [store, row.id, b.packSize, b.packCost, req.context.user.id],
        );
      await audit(
        c,
        {
          storeId: store,
          employeeId: req.context.user.id,
          deviceId: req.context.device.id,
        },
        b.id ? 'Supplier price updated' : 'Supplier product linked',
        row.id,
        { supplierId: b.supplierId, productId: b.productId, packCost: b.packCost },
      );
      return { id: row.id };
    });
  }
  @Get('supplier-products/:id/history') @Require('suppliers.read') async offerHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return (
      await this.database.pool.query(
        `SELECT h.pack_size::text AS "packSize",h.pack_cost::text AS "packCost",
         h.recorded_at AS "recordedAt",e.name AS "employeeName"
         FROM supplier_price_history h LEFT JOIN employees e ON e.id=h.employee_id
         WHERE h.supplier_product_id=$1 AND h.store_id=$2
         ORDER BY h.recorded_at DESC LIMIT 100`,
        [id, req.context.store.id],
      )
    ).rows;
  }
  @Get('purchases') @Require('purchases.read') async list(
    @Req() req: AuthRequest,
    @Query('search') search?: string,
  ) {
    const term = parse(z.string().max(200).default(''), search).trim().toLowerCase();
    return (
      await this.database.pool.query(
        `SELECT p.id,p.number,p.supplier_id,p.supplier_reference,p.document_date::text,p.status,p.version,p.total,p.payment_status,p.payment_due_date::text,p.paid_at,
(p.payment_status='unpaid' AND p.status IN ('ordered','partially_received','received','closed') AND p.payment_due_date IS NOT NULL AND p.payment_due_date < (now() AT TIME ZONE (SELECT timezone FROM stores WHERE id=p.store_id))::date) AS payment_overdue,p.created_at AS "createdAt",s.name AS "supplierName" FROM purchases p JOIN suppliers s ON s.id=p.supplier_id WHERE p.store_id=$1 AND ($2='' OR strpos(lower(p.number),$2)>0 OR strpos(lower(s.name),$2)>0 OR strpos(lower(p.supplier_reference),$2)>0) ORDER BY p.created_at DESC LIMIT 200`,
        [req.context.store.id, term],
      )
    ).rows;
  }
  @Get('purchases/:id') @Require('purchases.read') async detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    const c = await this.database.pool.connect();
    try {
      return await this.details(c, id, req.context.store.id);
    } finally {
      c.release();
    }
  }
  @Delete('purchases/:id') @Require('purchases.write') async deletePurchase(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    try {
      return await this.run(req, randomUUID(), 'purchase-delete', { id }, async (c) => {
        const order = (
          await c.query(
            'SELECT number,status FROM purchases WHERE id=$1 AND store_id=$2 FOR UPDATE',
            [id, req.context.store.id],
          )
        ).rows[0];
        if (!order) throw new NotFoundException('Order not found.');
        if (order.status !== 'draft')
          throw new ConflictException(
            'Only draft purchases can be deleted. Keep placed and received orders for history.',
          );
        await c.query('DELETE FROM purchase_lines WHERE purchase_id=$1 AND store_id=$2', [
          id,
          req.context.store.id,
        ]);
        await c.query('DELETE FROM purchases WHERE id=$1 AND store_id=$2', [
          id,
          req.context.store.id,
        ]);
        await audit(
          c,
          {
            storeId: req.context.store.id,
            employeeId: req.context.user.id,
            deviceId: req.context.device.id,
          },
          'Purchase deleted',
          id,
          { number: order.number },
        );
        return { deleted: true };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23503')
        throw new ConflictException(
          'This purchase is linked to a delivery, stock movement or shopping list and cannot be deleted.',
        );
      throw error;
    }
  }
  private async details(c: PoolClient, id: string, store: string) {
    const p = (
      await c.query(
        `SELECT p.*,(SELECT name FROM employees WHERE id=p.closed_by) AS closed_by_name,p.payment_due_date::text,
(p.payment_status='unpaid' AND p.status IN ('ordered','partially_received','received','closed') AND p.payment_due_date IS NOT NULL AND p.payment_due_date < (now() AT TIME ZONE (SELECT timezone FROM stores WHERE id=p.store_id))::date) AS payment_overdue,s.name AS "supplierName",s.code AS "supplierCode",s.phone AS "supplierPhone",s.company_number AS "supplierCompanyNumber",s.contact_name AS "supplierContactName",s.contact_phone AS "supplierContactPhone" FROM purchases p JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=$1 AND p.store_id=$2`,
        [id, store],
      )
    ).rows[0];
    if (!p) throw new NotFoundException('Order not found.');
    const lines = (
      await c.query('SELECT * FROM purchase_lines WHERE purchase_id=$1 ORDER BY sku', [id])
    ).rows;
    const receipts = (
      await c.query(
        `SELECT g.*,e.name AS actor,d.name AS device FROM goods_receipts g JOIN employees e ON e.id=g.employee_id JOIN device_records d ON d.id=g.device_id WHERE g.purchase_id=$1 ORDER BY g.created_at DESC`,
        [id],
      )
    ).rows;
    for (const r of receipts)
      r.lines = (
        await c.query(
          `SELECT l.*, CASE WHEN l.expiry_batches='[]'::jsonb
          THEN jsonb_build_array(jsonb_build_object('quantity',l.quantity::text,'expiryDate',l.expiry_date::text))
          ELSE l.expiry_batches END AS expiry_batches
          FROM goods_receipt_lines l WHERE l.receipt_id=$1 AND l.store_id=$2 ORDER BY l.sku`,
          [r.id, store],
        )
      ).rows;
    return { ...p, lines, receipts };
  }
  @Post('purchases/:id/payment') @Require('purchases.write') async payment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(purchasePaymentSchema, input);
    return this.run(req, b.requestId, 'payment', { id, ...b }, async (c) => {
      const previous = await this.lock(c, id, req.context.store.id, b.version);
      if (previous.status === 'cancelled')
        throw new ConflictException('Cancelled orders cannot change payment status.');
      await c.query(
        "UPDATE purchases SET payment_status=$1,payment_due_date=$2,paid_at=CASE WHEN $1='paid' THEN COALESCE(paid_at,now()) ELSE NULL END,version=version+1 WHERE id=$3",
        [b.status, b.dueDate || null, id],
      );
      await audit(
        c,
        {
          storeId: req.context.store.id,
          employeeId: req.context.user.id,
          deviceId: req.context.device.id,
        },
        'Purchase payment updated',
        id,
        {
          before: {
            status: previous.payment_status,
            dueDate: previous.payment_due_date,
            paidAt: previous.paid_at,
          },
          after: { status: b.status, dueDate: b.dueDate || null },
        },
      );
      return this.details(c, id, req.context.store.id);
    });
  }
  /**
   * Proposes purchase lines from a photo of a supplier document.
   *
   * Deliberately read-only: it creates nothing and changes nothing. The
   * response is a suggestion for a person to review on screen, and saving it
   * means calling `POST /purchases` as normal. `purchases.write` is required
   * even so, because the feature must not let anyone reach a purchase workflow
   * they could not already reach by typing.
   */
  @Post('purchases/extract') @Require('purchases.write') async extract(
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(extractionRequestSchema, input);
    const store = req.context.store.id;
    if (b.supplierId) {
      const supplier = await this.database.pool.query(
        'SELECT id FROM suppliers WHERE id=$1 AND store_id=$2 AND active',
        [b.supplierId, store],
      );
      if (!supplier.rowCount) throw new NotFoundException('This supplier no longer exists.');
    }
    return extractPurchaseDocument(b.image, b.supplierId, store, this.database);
  }
  @Post('purchases/document-chat') @Require('purchases.write') async documentChat(
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(
      z.object({
        question: z.string().trim().min(1).max(500),
        document: z.object({
          supplierName: z.string().max(120),
          supplierCode: z.string().max(60),
          supplierCompanyNumber: z.string().max(120),
          supplierPhone: z.string().max(60),
          contactName: z.string().max(120),
          contactPhone: z.string().max(60),
          supplierReference: z.string().max(120),
          documentDate: z.string().max(10),
          lines: z
            .array(
              z.object({
                description: z.string().max(200),
                supplierSku: z.string().max(60),
                barcode: z.string().max(40),
                quantity: z.string().max(32),
                unitCost: z.string().max(32),
              }),
            )
            .min(1)
            .max(100),
        }),
        history: z
          .array(
            z.object({
              role: z.enum(['user', 'assistant']),
              content: z.string().max(1000),
            }),
          )
          .max(6)
          .default([]),
      }),
      input,
    );
    return answerPurchaseDocumentQuestion(
      this.database,
      req.context.store.id,
      b.document,
      b.question,
      b.history,
    );
  }
  @Post('purchases') @Require('purchases.write') async draft(
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(
      purchaseDraftSchema.extend({
        requestId: z.uuid(),
        id: z.uuid().optional(),
        version: z.number().int().positive().optional(),
      }),
      input,
    );
    return this.run(req, b.requestId, 'draft', b, (c) => this.saveDraft(c, req, b));
  }
  private async saveDraft(
    c: PoolClient,
    req: AuthRequest,
    b: z.infer<typeof purchaseDraftSchema> & { id?: string; version?: number },
  ) {
    const store = req.context.store.id;
    if (b.id) {
      const previous = await this.lock(c, b.id, store, b.version ?? 0);
      if (previous.status !== 'draft') throw new ConflictException('Only drafts can be edited.');
    }
    if (
      !(
        await c.query('SELECT id FROM suppliers WHERE id=$1 AND store_id=$2 AND active FOR SHARE', [
          b.supplierId,
          store,
        ])
      ).rowCount
    )
      throw new BadRequestException('Choose an active supplier.');
    const lines = [];
    let subtotal = 0n,
      tax = 0n;
    for (const line of [...b.lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
      const p = (
        await c.query('SELECT * FROM products WHERE id=$1 AND store_id=$2 AND active FOR SHARE', [
          line.productId,
          store,
        ])
      ).rows[0];
      if (!p) throw new BadRequestException('Choose active products from this store.');
      this.whole(p.unit, line.quantity);
      const totals = calculatePurchaseLine(line.unitCost, line.quantity, line.taxRate);
      subtotal += toScaled(totals.subtotal, 2);
      tax += toScaled(totals.tax, 2);
      lines.push({ p, line, totals });
    }
    if (subtotal + tax > 99999999999n) throw new BadRequestException('Order total is too large.');
    const p = b.id
      ? { id: b.id }
      : (
          await c.query(
            `INSERT INTO purchases(store_id,supplier_id,number,supplier_reference,expected_date,notes,subtotal,tax,total,created_by,device_id,document_date,buyer_name,buyer_details,driver_name,driver_phone,goods_number,buyer_tax_number,gross_weight,document_vat,return_amount,document_comment) VALUES($1,$2,'PO-'||lpad(nextval('purchase_number_sequence')::text,6,'0'),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
            [
              store,
              b.supplierId,
              b.supplierReference,
              b.expectedDate || null,
              b.notes,
              fromScaled(subtotal, 2),
              fromScaled(tax, 2),
              fromScaled(subtotal + tax, 2),
              req.context.user.id,
              req.context.device.id,
              b.documentDate || null,
              b.buyerName,
              b.buyerDetails,
              b.driverName,
              b.driverPhone,
              b.goodsNumber,
              b.buyerTaxNumber,
              b.grossWeight,
              b.documentVat,
              b.returnAmount,
              b.documentComment,
            ],
          )
        ).rows[0];
    if (b.id) {
      await c.query('DELETE FROM purchase_lines WHERE purchase_id=$1', [b.id]);
      await c.query(
        'UPDATE purchases SET supplier_id=$2,supplier_reference=$3,expected_date=$4,notes=$5,subtotal=$6,tax=$7,total=$8,document_date=$9,buyer_name=$10,buyer_details=$11,driver_name=$12,driver_phone=$13,goods_number=$14,buyer_tax_number=$15,gross_weight=$16,document_vat=$17,return_amount=$18,document_comment=$19,version=version+1 WHERE id=$1',
        [
          b.id,
          b.supplierId,
          b.supplierReference,
          b.expectedDate || null,
          b.notes,
          fromScaled(subtotal, 2),
          fromScaled(tax, 2),
          fromScaled(subtotal + tax, 2),
          b.documentDate || null,
          b.buyerName,
          b.buyerDetails,
          b.driverName,
          b.driverPhone,
          b.goodsNumber,
          b.buyerTaxNumber,
          b.grossWeight,
          b.documentVat,
          b.returnAmount,
          b.documentComment,
        ],
      );
    }
    for (const { p: product, line, totals } of lines)
      await c.query(
        'INSERT INTO purchase_lines(store_id,purchase_id,product_id,product_name,sku,unit,ordered_quantity,unit_cost,tax_rate,subtotal,tax,total,proposed_selling_price) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
        [
          store,
          p.id,
          product.id,
          product.name,
          product.sku,
          product.unit,
          line.quantity,
          line.unitCost,
          line.taxRate,
          totals.subtotal,
          totals.tax,
          totals.total,
          line.sellingPrice ?? null,
        ],
      );
    // A purchase establishes that this supplier carries each selected product.
    // Preserve manually configured pack sizes, supplier SKUs and quoted prices.
    for (const { p: product, line } of lines) {
      const linked = (
        await c.query(
          `INSERT INTO supplier_products(store_id,supplier_id,product_id,pack_size,pack_cost)
           VALUES($1,$2,$3,1,$4)
           ON CONFLICT(supplier_id,product_id) DO NOTHING
           RETURNING id`,
          [store, b.supplierId, product.id, line.unitCost],
        )
      ).rows[0];
      if (linked) {
        await c.query(
          'INSERT INTO supplier_price_history(store_id,supplier_product_id,pack_size,pack_cost,employee_id) VALUES($1,$2,1,$3,$4)',
          [store, linked.id, line.unitCost, req.context.user.id],
        );
      } else {
        await c.query(
          `UPDATE supplier_products SET active=true,version=version+1,updated_at=now()
           WHERE store_id=$1 AND supplier_id=$2 AND product_id=$3 AND NOT active`,
          [store, b.supplierId, product.id],
        );
      }
    }
    await audit(
      c,
      { storeId: store, employeeId: req.context.user.id, deviceId: req.context.device.id },
      b.id ? 'Purchase draft edited' : 'Purchase drafted',
      p.id,
      { total: fromScaled(subtotal + tax, 2) },
    );
    return this.details(c, p.id, store);
  }
  private whole(unit: string, quantity: string) {
    if (['piece', 'pack', 'box'].includes(unit) && toScaled(quantity, 3) % 1000n !== 0n)
      throw new BadRequestException('This product requires a whole-number quantity.');
  }
  @Post('purchases/:id/status') @Require('purchases.write') async status(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(
      command.extend({
        status: z.enum(['ordered', 'cancelled']),
        reason: z.string().trim().max(500).default(''),
      }),
      input,
    );
    return this.run(req, b.requestId, 'status', { id, ...b }, async (c) => {
      const p = await this.lock(c, id, req.context.store.id, b.version);
      if (
        (b.status === 'ordered' && p.status !== 'draft') ||
        (b.status === 'cancelled' && !['draft', 'ordered'].includes(p.status))
      )
        throw new ConflictException('This order cannot make that transition.');
      if (b.status === 'cancelled' && !b.reason)
        throw new BadRequestException('Enter a cancellation reason.');
      if (
        b.status === 'ordered' &&
        !(
          await c.query('SELECT id FROM suppliers WHERE id=$1 AND active FOR SHARE', [
            p.supplier_id,
          ])
        ).rowCount
      )
        throw new BadRequestException('Activate the supplier before placing this order.');
      await c.query(
        "UPDATE purchases SET status=$2,version=version+1,cancel_reason=$3,ordered_at=CASE WHEN $2='ordered' THEN now() ELSE ordered_at END WHERE id=$1",
        [id, b.status, b.reason],
      );
      await audit(
        c,
        {
          storeId: req.context.store.id,
          employeeId: req.context.user.id,
          deviceId: req.context.device.id,
        },
        b.status === 'ordered' ? 'Purchase placed' : 'Purchase cancelled',
        id,
        { reason: b.reason },
      );
      return this.details(c, id, req.context.store.id);
    });
  }
  @Post('purchases/:id/close-remainder') @Require('purchases.write') async closeRemainder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(command.extend({ reason: z.string().trim().min(1).max(500) }), input);
    return this.run(req, b.requestId, 'close-remainder', { id, ...b }, async (c) => {
      const p = await this.lock(c, id, req.context.store.id, b.version);
      if (p.status !== 'partially_received')
        throw new ConflictException(
          'Only partially received orders can have their remainder closed.',
        );
      const remaining = (
        await c.query(
          'SELECT product_id,ordered_quantity-received_quantity AS quantity FROM purchase_lines WHERE purchase_id=$1 AND ordered_quantity>received_quantity ORDER BY product_id',
          [id],
        )
      ).rows;
      if (!remaining.length) throw new ConflictException('This order has no remaining quantities.');
      await c.query(
        "UPDATE purchases SET status='closed',close_reason=$2,closed_at=now(),closed_by=$3,version=version+1 WHERE id=$1",
        [id, b.reason, req.context.user.id],
      );
      await audit(
        c,
        {
          storeId: req.context.store.id,
          employeeId: req.context.user.id,
          deviceId: req.context.device.id,
        },
        'Purchase remainder closed',
        id,
        { reason: b.reason, remaining },
      );
      return this.details(c, id, req.context.store.id);
    });
  }
  private async lock(c: PoolClient, id: string, store: string, version: number) {
    const p = (
      await c.query('SELECT * FROM purchases WHERE id=$1 AND store_id=$2 FOR UPDATE', [id, store])
    ).rows[0];
    if (!p) throw new NotFoundException('Order not found.');
    if (p.version !== version)
      throw new ConflictException('Order changed. Refresh before continuing.');
    return p;
  }
  @Post('purchases/:id/receipts') @Require('purchases.receive') async receive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(receiptInputSchema, input);
    return this.run(req, b.requestId, 'receive', { id, ...b }, async (c) => {
      const store = req.context.store.id,
        p = await this.lock(c, id, store, b.version);
      if (!['ordered', 'partially_received'].includes(p.status))
        throw new ConflictException('Only placed orders can be received.');
      const orderLines = (
        await c.query('SELECT * FROM purchase_lines WHERE purchase_id=$1 ORDER BY product_id', [id])
      ).rows;
      const received = [];
      let subtotal = 0n,
        tax = 0n;
      for (const line of orderLines) {
        const entry = b.lines.find((l) => l.purchaseLineId === line.id);
        if (!entry) continue;
        const product = (
          await c.query('SELECT * FROM products WHERE id=$1 AND store_id=$2 FOR UPDATE', [
            line.product_id,
            store,
          ])
        ).rows[0];
        if (!product.active)
          throw new BadRequestException('Activate the product before receiving it.');
        this.whole(line.unit, entry.quantity);
        const expiryBatches = entry.expiryBatches ?? [
          { quantity: entry.quantity, expiryDate: entry.expiryDate ?? null },
        ];
        for (const batch of expiryBatches) this.whole(line.unit, batch.quantity);
        if (
          toScaled(entry.quantity, 3) + toScaled(line.received_quantity, 3) >
          toScaled(line.ordered_quantity, 3)
        )
          throw new BadRequestException('Delivery exceeds the remaining order quantity.');
        const cost = entry.unitCost ?? line.unit_cost;
        if (entry.sellingPrice !== undefined) {
          if (!req.context.user.permissions.includes('catalog.write'))
            throw new BadRequestException('You cannot change selling prices.');
          if (
            entry.expectedSellingPrice === undefined ||
            toScaled(entry.expectedSellingPrice, 2) !== toScaled(product.price, 2)
          )
            throw new ConflictException(
              'The selling price changed. Refresh the order and review the current price.',
            );
        }
        if (cost !== line.unit_cost && !req.context.user.permissions.includes('purchases.cost'))
          throw new BadRequestException('You cannot change receiving costs.');
        const totals = calculatePurchaseLine(cost, entry.quantity, line.tax_rate);
        subtotal += toScaled(totals.subtotal, 2);
        tax += toScaled(totals.tax, 2);
        received.push({ line, entry, cost, totals, product, expiryBatches });
      }
      if (received.length !== b.lines.length)
        throw new BadRequestException('Delivery contains a line outside this order.');
      if (subtotal + tax > 99999999999n)
        throw new BadRequestException('Delivery total is too large.');
      const receipt = (
        await c.query(
          `INSERT INTO goods_receipts(store_id,purchase_id,number,delivery_reference,notes,employee_id,device_id,subtotal,tax,total) VALUES($1,$2,'GR-'||lpad(nextval('goods_receipt_number_sequence')::text,6,'0'),$3,$4,$5,$6,$7,$8,$9) RETURNING id,number`,
          [
            store,
            id,
            b.deliveryReference,
            b.notes,
            req.context.user.id,
            req.context.device.id,
            fromScaled(subtotal, 2),
            fromScaled(tax, 2),
            fromScaled(subtotal + tax, 2),
          ],
        )
      ).rows[0];
      for (const { line, entry, cost, totals, product, expiryBatches } of received) {
        const receiptLine = (
          await c.query(
            'INSERT INTO goods_receipt_lines(store_id,receipt_id,purchase_line_id,product_id,product_name,sku,unit,quantity,unit_cost,tax_rate,subtotal,tax,total,expiry_date,expiry_batches) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id',
            [
              store,
              receipt.id,
              line.id,
              product.id,
              line.product_name,
              line.sku,
              line.unit,
              entry.quantity,
              cost,
              line.tax_rate,
              totals.subtotal,
              totals.tax,
              totals.total,
              expiryBatches.every(
                (b) => (b.expiryDate ?? null) === (expiryBatches[0].expiryDate ?? null),
              )
                ? (expiryBatches[0].expiryDate ?? null)
                : null,
              JSON.stringify(
                expiryBatches.map((b) => ({
                  quantity: b.quantity,
                  expiryDate: b.expiryDate ?? null,
                })),
              ),
            ],
          )
        ).rows[0];
        for (const batch of expiryBatches)
          await c.query(
            "INSERT INTO stock_batches(store_id,product_id,receipt_line_id,expiry_date,quantity,unit_cost,cost_source) VALUES($1,$2,$3,$4,$5,$6,'receipt')",
            [store, product.id, receiptLine.id, batch.expiryDate ?? null, batch.quantity, cost],
          );
        const balance = fromScaled(toScaled(product.stock, 3) + toScaled(entry.quantity, 3), 3);
        await c.query('UPDATE products SET stock=$2,cost=$3,price=COALESCE($4,price) WHERE id=$1', [
          product.id,
          balance,
          cost,
          entry.sellingPrice ?? null,
        ]);
        await c.query(
          'UPDATE purchase_lines SET received_quantity=received_quantity+$2 WHERE id=$1',
          [line.id, entry.quantity],
        );
        await c.query(
          "INSERT INTO movements(store_id,product_id,employee_id,device_id,quantity,balance,reason,notes,request_id,request_hash,purchase_id,goods_receipt_id) VALUES($1,$2,$3,$4,$5,$6,'received',$7,$8,$9,$10,$11)",
          [
            store,
            product.id,
            req.context.user.id,
            req.context.device.id,
            entry.quantity,
            balance,
            receipt.number + ' ' + b.deliveryReference,
            randomUUID(),
            hash(JSON.stringify(entry)),
            id,
            receipt.id,
          ],
        );
      }
      await c.query(
        "UPDATE purchases SET version=version+1,status=CASE WHEN EXISTS(SELECT 1 FROM purchase_lines WHERE purchase_id=$1 AND received_quantity<ordered_quantity) THEN 'partially_received' ELSE 'received' END WHERE id=$1",
        [id],
      );
      await audit(
        c,
        { storeId: store, employeeId: req.context.user.id, deviceId: req.context.device.id },
        'Purchase received',
        id,
        {
          receiptId: receipt.id,
          number: receipt.number,
          lines: received.map(({ line, entry, cost, product, expiryBatches }) => ({
            productId: product.id,
            quantity: entry.quantity,
            previousCost: product.cost,
            cost,
            orderedCost: line.unit_cost,
            expiryBatches,
            previousSellingPrice: product.price,
            sellingPrice: entry.sellingPrice ?? product.price,
          })),
        },
      );
      return this.details(c, id, store);
    });
  }
}
@Module({ imports: [AuthModule], controllers: [PurchasingController], providers: [Operations] })
export class PurchasingModule {}
