import { Controller, Get, Module, Query, Req, UseGuards } from '@nestjs/common';
import { periodRange, storeToday } from '@eliza/contracts';
import { z } from 'zod';
import { AuthModule } from './auth.js';
import { Database } from './database.js';
import { FinancialMetricsModule, FinancialMetricsService } from './financial-metrics.js';
import { AccessGuard, parse, Require, type AuthRequest } from './security.js';

@Controller('reports')
@UseGuards(AccessGuard)
export class PricingReportController {
  constructor(
    private readonly database: Database,
    private readonly metrics: FinancialMetricsService,
  ) {}

  @Get('pricing-sources') @Require('analytics.margin') async report(
    @Req() req: AuthRequest,
    @Query('period') input: unknown,
  ) {
    const period = parse(z.enum(['today', 'week', 'month']), input);
    const timezone = req.context.store.timezone;
    const range = periodRange(period, storeToday(new Date(), timezone));
    // Only the descriptive units/discounts are grouped here. Every money/profit
    // figure below is calculated by the same service used by Overview.
    const sources = (
      await this.database.pool.query(
        `WITH bounds AS (
        SELECT ($2::date::timestamp AT TIME ZONE $4) AS start_at,
          (($3::date+1)::timestamp AT TIME ZONE $4) AS end_at
      ), entries AS (
        SELECT COALESCE(i.pricing_source,CASE WHEN p.price_kind='limited_discount'
          THEN 'LEGACY_MARKDOWN' ELSE 'LEGACY_UNCLASSIFIED' END) AS source,
          i.quantity AS units,COALESCE(i.discount_total,0) AS discount
        FROM sale_items i JOIN sales s ON s.id=i.sale_id AND s.store_id=i.store_id
        JOIN products p ON p.id=i.product_id AND p.store_id=i.store_id CROSS JOIN bounds b
        WHERE i.store_id=$1 AND s.created_at>=b.start_at AND s.created_at<b.end_at
        UNION ALL
        SELECT COALESCE(i.pricing_source,'LEGACY_UNCLASSIFIED'),0,0
        FROM refund_lines l JOIN refunds r ON r.id=l.refund_id AND r.store_id=l.store_id
        LEFT JOIN sale_items i ON i.id=l.sale_item_id AND i.store_id=l.store_id CROSS JOIN bounds b
        WHERE l.store_id=$1 AND r.created_at>=b.start_at AND r.created_at<b.end_at
      ) SELECT source,sum(units)::text AS units,sum(discount)::text AS discount
        FROM entries GROUP BY source ORDER BY source`,
        [req.context.store.id, range.from, range.to, timezone],
      )
    ).rows as { source: string; units: string; discount: string }[];
    return Promise.all(
      sources.map(async (row) => {
        const summary = await this.metrics.getFinancialSummary(
          req.context.store.id,
          { ...range, timezone },
          { pricingSource: row.source },
        );
        return {
          ...row,
          revenue: summary.breakdown.completedSales,
          refunds: summary.adjustments.completedRefunds,
          netRevenue: summary.revenue,
          costOfGoodsSold: summary.cogs,
          grossProfit: summary.grossProfit,
          costComplete: summary.dataQuality.costComplete,
        };
      }),
    );
  }
}

@Module({ imports: [AuthModule, FinancialMetricsModule], controllers: [PricingReportController] })
export class PricingReportModule {}
