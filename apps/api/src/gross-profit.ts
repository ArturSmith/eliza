import { Controller, Get, Module, Query, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { z } from 'zod';
import { Database } from './database.js';
import { AuthModule } from './auth.js';
import { AccessGuard, Require, parse, type AuthRequest } from './security.js';
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
const range = z
  .object({ from: date, to: date })
  .refine((v) => v.from <= v.to, 'Start date must not follow end date')
  .refine(
    (v) => Date.parse(v.to) - Date.parse(v.from) <= 3660 * 86400000,
    'Choose ten years or less',
  );
@Controller('reports')
@UseGuards(AccessGuard)
class GrossProfitController {
  constructor(private database: Database) {}
  @Get('gross-profit') @Require('costs.read') async report(
    @Query() input: unknown,
    @Req() req: AuthRequest,
  ) {
    if (!req.context.user.permissions.includes('sales.read'))
      throw new ForbiddenException('Sales reporting permission is required.');
    const b = parse(range, input);
    const result = (
      await this.database.pool.query(
        `WITH bounds AS (
 SELECT ($2::date::timestamp AT TIME ZONE $4) AS start,(($3::date+1)::timestamp AT TIME ZONE $4) AS finish
 ), sold AS (
 SELECT s.id,s.total,s.tax FROM sales s,bounds b WHERE s.store_id=$1 AND s.created_at>=b.start AND s.created_at<b.finish
 ), original_costs AS (
 SELECT sale_id,product_id,sum(quantity) AS quantity,sum(round(cost*quantity,2)) AS cost FROM sale_items WHERE store_id=$1 GROUP BY sale_id,product_id
 ), return_history AS (
 SELECT r.id,r.created_at,l.product_id,l.restock,l.quantity,c.cost,c.quantity AS sold_quantity,
 COALESCE(sum(CASE WHEN l.restock THEN l.quantity ELSE 0 END) OVER(PARTITION BY l.sale_id,l.product_id ORDER BY r.created_at,r.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS prior_restock
 FROM refund_lines l JOIN refunds r ON r.id=l.refund_id AND r.store_id=l.store_id
 LEFT JOIN original_costs c ON c.sale_id=l.sale_id AND c.product_id=l.product_id WHERE l.store_id=$1
 ), return_costs AS (
 SELECT COALESCE(sum(CASE WHEN restock THEN round(cost*(prior_restock+quantity)/sold_quantity,2)-round(cost*prior_restock/sold_quantity,2) ELSE 0 END),0) AS restored,
 count(*) FILTER(WHERE cost IS NULL) AS missing
 FROM return_history,bounds b WHERE created_at>=b.start AND created_at<b.finish
 ), amounts AS (
 SELECT COALESCE((SELECT sum(total-tax) FROM sold),0) AS sales,
 COALESCE((SELECT sum(r.total-r.tax) FROM refunds r,bounds b WHERE r.store_id=$1 AND r.created_at>=b.start AND r.created_at<b.finish),0) AS returns,
 COALESCE((SELECT sum(c.cost) FROM original_costs c JOIN sold s ON s.id=c.sale_id),0) AS sold_cost,
 rc.restored,
 rc.missing+(SELECT count(*) FROM sold s WHERE NOT EXISTS(SELECT 1 FROM original_costs c WHERE c.sale_id=s.id)) AS missing
 FROM return_costs rc
 ), totals AS (SELECT *,sales-returns AS revenue,sold_cost-restored AS cogs FROM amounts)
 SELECT sales::text AS "salesExTax",returns::text AS "refundsExTax",revenue::text AS "netRevenue",
 CASE WHEN missing=0 THEN sold_cost::text END AS "soldCost",
 CASE WHEN missing=0 THEN restored::text END AS "restoredCost",
 CASE WHEN missing=0 THEN cogs::text END AS "costOfGoodsSold",
 CASE WHEN missing=0 THEN (revenue-cogs)::text END AS "grossProfit",
 CASE WHEN missing=0 AND revenue>0 THEN round((revenue-cogs)*100/revenue,2)::text END AS "marginPercent",
 missing::text AS "missingCostRecords" FROM totals`,
        [req.context.store.id, b.from, b.to, req.context.store.timezone],
      )
    ).rows[0];
    return {
      ...result,
      from: b.from,
      to: b.to,
      currency: req.context.store.currency,
      timezone: req.context.store.timezone,
    };
  }
}
@Module({ imports: [AuthModule], controllers: [GrossProfitController] })
export class GrossProfitModule {}
