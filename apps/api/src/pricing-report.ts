import { Controller, Get, Module, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthModule } from './auth.js';
import { Database } from './database.js';
import { AccessGuard, parse, Require, type AuthRequest } from './security.js';

@Controller('reports')
@UseGuards(AccessGuard)
export class PricingReportController {
  constructor(private database: Database) {}
  @Get('pricing-sources') @Require('analytics.margin') async report(
    @Req() req: AuthRequest,
    @Query('period') input: unknown,
  ) {
    const period = parse(z.enum(['today', 'week', 'month']), input);
    return (
      await this.database.pool.query(
        `WITH bounds AS (
        SELECT date_trunc($2,now() AT TIME ZONE timezone) AT TIME ZONE timezone AS start_at,
          (date_trunc($2,now() AT TIME ZONE timezone)+CASE $2
            WHEN 'day' THEN interval '1 day' WHEN 'week' THEN interval '1 week'
            ELSE interval '1 month' END) AT TIME ZONE timezone AS end_at
        FROM stores WHERE id=$1
      ), sold AS (
        SELECT COALESCE(i.pricing_source,CASE WHEN p.price_kind='limited_discount'
          THEN 'LEGACY_MARKDOWN' ELSE 'LEGACY_UNCLASSIFIED' END) AS source,
          sum(i.quantity) AS units,sum(i.total) AS revenue,
          sum(COALESCE(i.cost_total,round(i.cost*i.quantity,2))) AS cost,
          sum(COALESCE(i.discount_total,0)) AS discount
        FROM sale_items i JOIN sales s ON s.id=i.sale_id AND s.store_id=i.store_id
        JOIN products p ON p.id=i.product_id AND p.store_id=i.store_id CROSS JOIN bounds b
        WHERE i.store_id=$1 AND s.created_at>=b.start_at AND s.created_at<b.end_at
        GROUP BY 1
      ), returned AS (
        SELECT COALESCE(i.pricing_source,'LEGACY_UNCLASSIFIED') AS source,
          sum(l.total) AS refunds,sum(COALESCE(l.restored_cost,0)) AS restored_cost
        FROM refund_lines l JOIN refunds r ON r.id=l.refund_id AND r.store_id=l.store_id
        LEFT JOIN sale_items i ON i.id=l.sale_item_id AND i.store_id=l.store_id CROSS JOIN bounds b
        WHERE l.store_id=$1 AND r.created_at>=b.start_at AND r.created_at<b.end_at
        GROUP BY 1
      )
      SELECT COALESCE(s.source,r.source) AS source,COALESCE(s.units,0)::text AS units,
        COALESCE(s.revenue,0)::text AS revenue,COALESCE(s.discount,0)::text AS discount,
        COALESCE(r.refunds,0)::text AS refunds,
        (COALESCE(s.revenue,0)-COALESCE(r.refunds,0))::text AS "netRevenue",
        (COALESCE(s.cost,0)-COALESCE(r.restored_cost,0))::text AS "costOfGoodsSold",
        (COALESCE(s.revenue,0)-COALESCE(r.refunds,0)-COALESCE(s.cost,0)+COALESCE(r.restored_cost,0))::text AS "grossProfit"
      FROM sold s FULL JOIN returned r ON r.source=s.source ORDER BY source`,
        [req.context.store.id, period === 'today' ? 'day' : period],
      )
    ).rows;
  }
}
@Module({ imports: [AuthModule], controllers: [PricingReportController] })
export class PricingReportModule {}
