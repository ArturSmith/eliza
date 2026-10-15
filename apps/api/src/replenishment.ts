import {
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  planReplenishment,
  storeToday,
  addDays,
  toScaled,
  type Permission,
} from '@eliza/contracts';
import { z } from 'zod';
import { AuthModule } from './auth.js';
import { Database } from './database.js';
import { AccessGuard, parse, Require, type AuthRequest } from './security.js';

export const replenishmentPermissions: Permission[] = [
  'sales.read',
  'inventory.read',
  'purchases.read',
  'suppliers.read',
];
export const replenishmentQuery = z
  .object({
    historyDays: z.coerce.number().int().min(14).max(90).default(28),
    reviewDays: z.coerce.number().int().min(1).max(90).default(7),
    safetyDays: z.coerce.number().int().min(0).max(30).default(2),
    search: z.string().trim().max(100).default(''),
    productId: z.union([z.uuid(), z.literal('')]).default(''),
    status: z
      .enum([
        'all',
        'order_now',
        'order_later',
        'no_sales',
        'slow',
        'needs_review',
        'insufficient_history',
      ])
      .default('all'),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .strict();
export type ReplenishmentQuery = z.infer<typeof replenishmentQuery>;
@Injectable()
export class ReplenishmentService {
  constructor(private readonly database: Database) {}
  async report(req: AuthRequest, input: unknown) {
    if (!replenishmentPermissions.every((p) => req.context.user.permissions.includes(p)))
      throw new ForbiddenException(
        'Sales, inventory, purchasing and supplier access are required.',
      );
    const filters = parse(replenishmentQuery, input);
    const today = storeToday(new Date(), req.context.store.timezone);
    const pattern = '%' + filters.search.replace(/[\\%_]/g, '\\$&') + '%';
    const rows = (
      await this.database.pool.query(
        `WITH dates AS (
      SELECT $2::date AS today,$2::date-$3::int AS start
    ), product_map AS (
      SELECT id,COALESCE(base_product_id,id) AS base_id FROM products WHERE store_id=$1
    ), history AS (
      SELECT pm.base_id,min(m.created_at AT TIME ZONE $4)::date AS first_date,
        bool_or(m.balance<=0 AND m.created_at>=(d.start::timestamp AT TIME ZONE $4)) AS stockout_recorded
      FROM movements m JOIN product_map pm ON pm.id=m.product_id CROSS JOIN dates d
      WHERE m.store_id=$1 GROUP BY pm.base_id
    ), product_windows AS (
      SELECT p.id,CASE WHEN h.first_date IS NULL THEN d.today
        ELSE greatest(d.start,h.first_date+1,(p.created_at AT TIME ZONE $4)::date+1) END AS start
      FROM products p CROSS JOIN dates d LEFT JOIN history h ON h.base_id=p.id
      WHERE p.store_id=$1 AND p.base_product_id IS NULL
), demand AS (
      SELECT pm.base_id,sum(i.quantity)::text AS sold
      FROM sale_items i JOIN sales s ON s.id=i.sale_id AND s.store_id=i.store_id
      JOIN product_map pm ON pm.id=i.product_id JOIN product_windows w ON w.id=pm.base_id CROSS JOIN dates d
      WHERE i.store_id=$1 AND s.created_at>=(w.start::timestamp AT TIME ZONE $4)
        AND s.created_at<(d.today::timestamp AT TIME ZONE $4) GROUP BY pm.base_id
    ), returned AS (
      SELECT pm.base_id,sum(l.quantity)::text AS returned
      FROM refund_lines l JOIN refunds r ON r.id=l.refund_id AND r.store_id=l.store_id
      JOIN product_map pm ON pm.id=l.product_id JOIN product_windows w ON w.id=pm.base_id CROSS JOIN dates d
      WHERE l.store_id=$1 AND r.created_at>=(w.start::timestamp AT TIME ZONE $4)
        AND r.created_at<(d.today::timestamp AT TIME ZONE $4) GROUP BY pm.base_id
    ), batches AS (
      SELECT pm.base_id,sum(b.quantity) AS total,
        sum(b.quantity) FILTER(WHERE b.expiry_date IS NULL OR b.expiry_date>d.today) AS available,
        sum(b.quantity) FILTER(WHERE b.expiry_date<=d.today) AS expired,
        sum(b.quantity) FILTER(WHERE b.expiry_date IS NULL) AS unknown_expiry
        ,COALESCE(jsonb_agg(jsonb_build_object('quantity',b.quantity::text,'expiry',b.expiry_date::text)) FILTER(WHERE b.quantity>0 AND (b.expiry_date IS NULL OR b.expiry_date>d.today)),'[]'::jsonb) AS lots
      FROM stock_batches b JOIN product_map pm ON pm.id=b.product_id CROSS JOIN dates d
      WHERE b.store_id=$1 GROUP BY pm.base_id
    ), supply AS (
      SELECT l.product_id,
        COALESCE(sum(l.ordered_quantity-l.received_quantity) FILTER(WHERE o.status IN ('ordered','partially_received')),0)::text AS incoming,
        COALESCE(sum(l.ordered_quantity) FILTER(WHERE o.status='draft'),0)::text AS drafts,
        COALESCE(sum(l.ordered_quantity-l.received_quantity) FILTER(WHERE o.status IN ('ordered','partially_received') AND (o.expected_date IS NULL OR o.expected_date<d.today)),0)::text AS uncertain,
        COALESCE(jsonb_agg(jsonb_build_object('quantity',(l.ordered_quantity-l.received_quantity)::text,'date',o.expected_date::text)) FILTER(WHERE o.status IN ('ordered','partially_received') AND o.expected_date>=d.today AND l.ordered_quantity>l.received_quantity),'[]'::jsonb) AS arrivals
      FROM purchase_lines l JOIN purchases o ON o.id=l.purchase_id AND o.store_id=l.store_id CROSS JOIN dates d
      WHERE l.store_id=$1 AND o.status IN ('draft','ordered','partially_received') GROUP BY l.product_id
    )
    SELECT p.id AS "productId",p.name,p.sku,p.unit,p.category,
      (p.stock+COALESCE((SELECT sum(child.stock) FROM products child WHERE child.store_id=$1 AND child.base_product_id=p.id),0))::text AS stock,
      COALESCE(b.total,0)::text AS "batchStock",COALESCE(b.available,0)::text AS available,
      COALESCE(b.lots,'[]'::jsonb) AS lots,COALESCE(b.expired,0)::text AS expired,COALESCE(b.unknown_expiry,0)::text AS "unknownExpiry",
      COALESCE(dem.sold,'0') AS sold,COALESCE(ret.returned,'0') AS returned,
      CASE WHEN h.first_date IS NULL THEN 0 ELSE greatest(0,d.today-greatest(d.start,h.first_date+1,(p.created_at AT TIME ZONE $4)::date+1)) END AS "observedDays",
      COALESCE(h.stockout_recorded,false) AS "stockoutRecorded",
      COALESCE(s.incoming,'0') AS incoming,COALESCE(s.drafts,'0') AS drafts,
      COALESCE(s.uncertain,'0') AS "uncertainIncoming",COALESCE(s.arrivals,'[]'::jsonb) AS arrivals,
      offer.supplier_id AS "supplierId",offer.supplier_name AS "supplierName",
      offer.lead_time_days AS "leadDays",COALESCE(offer.pack_size,'1') AS "packSize",COALESCE(offer.minimum_order,'0') AS "minimumOrder"
    FROM products p CROSS JOIN dates d
    LEFT JOIN demand dem ON dem.base_id=p.id LEFT JOIN returned ret ON ret.base_id=p.id
    LEFT JOIN history h ON h.base_id=p.id LEFT JOIN batches b ON b.base_id=p.id
    LEFT JOIN supply s ON s.product_id=p.id LEFT JOIN reorder_preferences pref ON pref.product_id=p.id AND pref.store_id=p.store_id
    LEFT JOIN LATERAL (
      SELECT sp.supplier_id,sup.name AS supplier_name,sp.lead_time_days,sp.pack_size::text,sp.minimum_order::text
      FROM supplier_products sp JOIN suppliers sup ON sup.id=sp.supplier_id AND sup.store_id=sp.store_id
      WHERE sp.store_id=$1 AND sp.product_id=p.id AND sp.active AND sup.active
        AND (sp.supplier_id=pref.supplier_id OR (pref.supplier_id IS NULL AND 1=(SELECT count(*) FROM supplier_products x JOIN suppliers xs ON xs.id=x.supplier_id AND xs.store_id=x.store_id WHERE x.store_id=$1 AND x.product_id=p.id AND x.active AND xs.active)))
      ORDER BY sp.id LIMIT 1
    ) offer ON true
    WHERE p.store_id=$1 AND p.active AND p.base_product_id IS NULL
      AND ($5='%%' OR p.name ILIKE $5 OR p.sku ILIKE $5) AND ($6='' OR p.id::text=$6)
    ORDER BY p.name,p.id LIMIT 5001`,
        [
          req.context.store.id,
          today,
          filters.historyDays,
          req.context.store.timezone,
          pattern,
          filters.productId,
        ],
      )
    ).rows;
    const planned = rows
      .slice(0, 5000)
      .map((row) => {
        const plan = planReplenishment({
          today,
          unit: row.unit,
          sold: row.sold,
          observedDays: row.observedDays,
          available: row.available,
          incoming: row.arrivals,
          uncertainIncoming: row.uncertainIncoming,
          leadDays: row.leadDays,
          packSize: row.packSize,
          minimumOrder: row.minimumOrder,
          reviewDays: filters.reviewDays,
          safetyDays: filters.safetyDays,
          stockReconciled: toScaled(row.stock, 3) === toScaled(row.batchStock, 3),
          stockLots: row.lots,
        });
        if (row.stockoutRecorded) plan.warnings.push('stockout_history');
        if (Number(row.unknownExpiry) > 0) plan.warnings.push('unknown_expiry');
        if (Number(row.drafts) > 0) plan.warnings.push('draft_orders');
        if (!row.supplierId) plan.warnings.push('choose_supplier');
        return { ...row, ...plan };
      })
      .filter(
        (row) =>
          filters.status === 'all' ||
          row.status === filters.status ||
          row.demandStatus === filters.status,
      );
    const rank: Record<string, number> = {
      order_now: 0,
      needs_review: 1,
      order_later: 2,
      insufficient_history: 3,
      no_demand: 4,
      covered: 5,
    };
    planned.sort(
      (a, b) =>
        rank[a.status] - rank[b.status] ||
        a.name.localeCompare(b.name) ||
        a.productId.localeCompare(b.productId),
    );
    return {
      today,
      from: addDays(today, -filters.historyDays),
      to: addDays(today, -1),
      basis: {
        sales: 'gross_units',
        calendar: 'completed_store_local_days',
        minimumObservedDays: 14,
        availabilityAdjusted: false,
      },
      timezone: req.context.store.timezone,
      historyDays: filters.historyDays,
      reviewDays: filters.reviewDays,
      safetyDays: filters.safetyDays,
      total: planned.length,
      page: filters.page,
      pageSize: 50,
      truncated: rows.length > 5000,
      rows: planned.slice((filters.page - 1) * 50, filters.page * 50),
    };
  }
}
@Controller('reports')
@UseGuards(AccessGuard)
class ReplenishmentController {
  constructor(private readonly service: ReplenishmentService) {}
  @Get('replenishment') @Require('inventory.read') report(
    @Query() query: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.report(req, query);
  }
}
@Module({
  imports: [AuthModule],
  providers: [ReplenishmentService],
  controllers: [ReplenishmentController],
  exports: [ReplenishmentService],
})
export class ReplenishmentModule {}
