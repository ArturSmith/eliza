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
import { fromScaled, toScaled } from '@eliza/contracts';
import { z } from 'zod';
import { AuthModule } from './auth.js';
import { Database } from './database.js';
import { allocatedExpenseCents, type ExpenseAllocation } from './financial-allocation.js';
import { AccessGuard, parse, Require, type AuthRequest } from './security.js';

const date = z.iso.date();
const periodQuery = z
  .object({ from: date, to: date })
  .refine((p) => p.from <= p.to, 'Start date must not follow end date');
export type FinancialPeriod = { from: string; to: string; timezone: string };
export type FinancialFilters = {
  productId?: string;
  shiftId?: string;
  cutoffHour?: number;
  pricingSource?: string;
};
const cents = (value: unknown) => toScaled(String(value ?? '0'), 2);
const money = (value: bigint) => fromScaled(value, 2);
function percent(numerator: bigint, denominator: bigint): string | null {
  if (denominator <= 0n) return null;
  const signed = numerator < 0n ? -1n : 1n;
  const value = numerator < 0n ? -numerator : numerator;
  return fromScaled(signed * ((value * 10000n + denominator / 2n) / denominator), 2);
}

/** Canonical management economics. All dates are store-local and inclusive. */
@Injectable()
export class FinancialMetricsService {
  constructor(private readonly database: Database) {}

  async getFinancialSummary(
    storeId: string,
    period: FinancialPeriod,
    filters: FinancialFilters = {},
  ) {
    if (period.from > period.to) throw new Error('Invalid financial period');
    const productId = filters.productId || null;
    const shiftId = filters.shiftId || null;
    const cutoffHour = filters.cutoffHour ?? null;
    const pricingSource = filters.pricingSource || null;
    const filtered = productId !== null || shiftId !== null || pricingSource !== null;
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const facts = (
        await client.query(
          `WITH bounds AS (
  SELECT ($2::date::timestamp AT TIME ZONE $4) AS start_at,
         (($3::date+1)::timestamp AT TIME ZONE $4) AS end_at
), sold AS (
  SELECT s.id,CASE WHEN $5::uuid IS NULL AND $8::text IS NULL THEN s.total ELSE
    (SELECT sum(i.total) FROM sale_items i LEFT JOIN products p ON p.id=i.product_id AND p.store_id=i.store_id
     WHERE i.store_id=$1 AND i.sale_id=s.id AND ($5::uuid IS NULL OR i.product_id=$5::uuid OR p.base_product_id=$5::uuid)
       AND ($8::text IS NULL OR COALESCE(i.pricing_source,CASE WHEN p.price_kind='limited_discount' THEN 'LEGACY_MARKDOWN' ELSE 'LEGACY_UNCLASSIFIED' END)=$8)) END AS total
  FROM sales s CROSS JOIN bounds b
  WHERE s.store_id=$1 AND s.created_at>=b.start_at AND s.created_at<b.end_at
    AND ($6::uuid IS NULL OR s.shift_id=$6::uuid)
    AND ($7::int IS NULL OR extract(hour from s.created_at AT TIME ZONE $4)<=$7::int)
    AND (($5::uuid IS NULL AND $8::text IS NULL) OR EXISTS(SELECT 1 FROM sale_items i LEFT JOIN products p
      ON p.id=i.product_id AND p.store_id=i.store_id
      WHERE i.store_id=$1 AND i.sale_id=s.id AND ($5::uuid IS NULL OR i.product_id=$5::uuid OR p.base_product_id=$5::uuid)
        AND ($8::text IS NULL OR COALESCE(i.pricing_source,CASE WHEN p.price_kind='limited_discount' THEN 'LEGACY_MARKDOWN' ELSE 'LEGACY_UNCLASSIFIED' END)=$8)))
), sold_lines AS (
  SELECT i.sale_id,i.total,
    CASE WHEN i.cost_total IS NULL AND i.cost IS NULL THEN NULL
         WHEN EXISTS(SELECT 1 FROM sale_batch_allocations a
           JOIN stock_batches b ON b.id=a.batch_id AND b.store_id=a.store_id
           WHERE a.sale_item_id=i.id AND a.store_id=i.store_id AND b.cost_source='legacy_estimate') THEN NULL
         ELSE COALESCE(i.cost_total,round(i.cost*i.quantity,2)) END AS historical_cost
  FROM sale_items i JOIN sold s ON s.id=i.sale_id LEFT JOIN products p ON p.id=i.product_id AND p.store_id=i.store_id
  WHERE i.store_id=$1 AND ($5::uuid IS NULL OR i.product_id=$5::uuid OR p.base_product_id=$5::uuid)
    AND ($8::text IS NULL OR COALESCE(i.pricing_source,CASE WHEN p.price_kind='limited_discount' THEN 'LEGACY_MARKDOWN' ELSE 'LEGACY_UNCLASSIFIED' END)=$8)
), returned AS (
  SELECT r.id,CASE WHEN $5::uuid IS NULL AND $8::text IS NULL THEN r.total ELSE
    (SELECT sum(l.total) FROM refund_lines l LEFT JOIN products p ON p.id=l.product_id AND p.store_id=l.store_id
     LEFT JOIN sale_items i ON i.id=l.sale_item_id AND i.store_id=l.store_id
     WHERE l.store_id=$1 AND l.refund_id=r.id AND ($5::uuid IS NULL OR l.product_id=$5::uuid OR p.base_product_id=$5::uuid)
       AND ($8::text IS NULL OR COALESCE(i.pricing_source,'LEGACY_UNCLASSIFIED')=$8)) END AS total
  FROM refunds r JOIN sales s ON s.id=r.sale_id AND s.store_id=r.store_id CROSS JOIN bounds b
  WHERE r.store_id=$1 AND r.created_at>=b.start_at AND r.created_at<b.end_at
    AND ($6::uuid IS NULL OR s.shift_id=$6::uuid)
    AND ($7::int IS NULL OR extract(hour from r.created_at AT TIME ZONE $4)<=$7::int)
    AND (($5::uuid IS NULL AND $8::text IS NULL) OR EXISTS(SELECT 1 FROM refund_lines l LEFT JOIN products p
      ON p.id=l.product_id AND p.store_id=l.store_id
      LEFT JOIN sale_items i ON i.id=l.sale_item_id AND i.store_id=l.store_id
      WHERE l.store_id=$1 AND l.refund_id=r.id AND ($5::uuid IS NULL OR l.product_id=$5::uuid OR p.base_product_id=$5::uuid)
        AND ($8::text IS NULL OR COALESCE(i.pricing_source,'LEGACY_UNCLASSIFIED')=$8)))
), original_lines AS (
  SELECT i.sale_id,i.product_id,i.quantity,
    CASE WHEN i.cost_total IS NULL AND i.cost IS NULL THEN NULL
      WHEN EXISTS(SELECT 1 FROM sale_batch_allocations a JOIN stock_batches b
        ON b.id=a.batch_id AND b.store_id=a.store_id
        WHERE a.store_id=$1 AND a.sale_item_id=i.id AND b.cost_source='legacy_estimate') THEN NULL
      ELSE COALESCE(i.cost_total,round(i.cost*i.quantity,2)) END AS historical_cost
  FROM sale_items i WHERE i.store_id=$1
), original_costs AS (
  SELECT sale_id,product_id,sum(quantity) AS quantity,
    CASE WHEN count(*) FILTER(WHERE historical_cost IS NULL)>0 THEN NULL
      ELSE sum(historical_cost) END AS cost
  FROM original_lines GROUP BY sale_id,product_id
), return_history AS (
  SELECT h.id AS refund_id,l.total,l.restock,l.loss_cost,l.restored_cost,l.quantity,c.cost,c.quantity AS original_quantity,
    COALESCE(i.pricing_source,'LEGACY_UNCLASSIFIED') AS pricing_source,
    COALESCE(sum(l.quantity) OVER(PARTITION BY l.sale_id,l.product_id ORDER BY h.created_at,h.id,l.id
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS prior_returned
  FROM refund_lines l JOIN refunds h ON h.id=l.refund_id AND h.store_id=l.store_id
  LEFT JOIN original_costs c ON c.sale_id=l.sale_id AND c.product_id=l.product_id
  LEFT JOIN sale_items i ON i.id=l.sale_item_id AND i.store_id=l.store_id
  LEFT JOIN products p ON p.id=l.product_id AND p.store_id=l.store_id
  WHERE l.store_id=$1 AND ($5::uuid IS NULL OR l.product_id=$5::uuid OR p.base_product_id=$5::uuid)
), returned_lines AS (
  SELECT h.total,h.restock,h.loss_cost,
    CASE WHEN NOT h.restock AND h.loss_cost IS NULL THEN NULL
      WHEN h.restored_cost IS NOT NULL THEN h.restored_cost
      WHEN h.cost IS NOT NULL AND h.original_quantity>0 AND h.restock THEN
        round(h.cost*(h.prior_returned+h.quantity)/h.original_quantity,2)-round(h.cost*h.prior_returned/h.original_quantity,2)
      ELSE NULL END AS historical_cost
  FROM return_history h JOIN returned r ON r.id=h.refund_id
  WHERE $8::text IS NULL OR h.pricing_source=$8
), lost AS (
  SELECT m.cost_total FROM movements m CROSS JOIN bounds b
  WHERE m.store_id=$1 AND m.reason IN ('expired','damaged') AND m.quantity<0
    AND m.created_at>=b.start_at AND m.created_at<b.end_at
    AND ($5::uuid IS NULL OR m.product_id=$5::uuid)
    AND ($7::int IS NULL OR extract(hour from m.created_at AT TIME ZONE $4)<=$7::int)
)
SELECT
  (SELECT COALESCE(sum(total),0)::text FROM sold) AS sales,
  (SELECT count(*)::int FROM sold) AS transactions,
  (SELECT COALESCE(sum(historical_cost),0)::text FROM sold_lines) AS sold_cost,
  (SELECT count(*)::int FROM sold_lines WHERE historical_cost IS NULL) AS missing_sale_cost,
  (SELECT COALESCE(sum(total) FILTER(WHERE historical_cost IS NULL),0)::text FROM sold_lines) AS missing_cost_revenue,
  (SELECT count(*)::int FROM sold s WHERE NOT EXISTS(SELECT 1 FROM sold_lines i WHERE i.sale_id=s.id)) AS sales_without_lines,
  (SELECT COALESCE(sum(total),0)::text FROM returned) AS refunds,
  (SELECT count(*)::int FROM returned) AS refund_count,
  (SELECT COALESCE(sum(historical_cost),0)::text FROM returned_lines) AS returned_cost,
  (SELECT count(*)::int FROM returned_lines WHERE historical_cost IS NULL) AS missing_refund_cost,
  (SELECT COALESCE(sum(cost_total),0)::text FROM lost) AS movement_losses,
  (SELECT count(*)::int FROM lost WHERE cost_total IS NULL) AS missing_movement_loss_cost,
  (SELECT COALESCE(sum(loss_cost),0)::text FROM returned_lines WHERE NOT restock) AS return_losses,
  (SELECT count(*)::int FROM returned_lines WHERE NOT restock AND loss_cost IS NULL) AS missing_return_loss_cost`,
          [
            storeId,
            period.from,
            period.to,
            period.timezone,
            productId,
            shiftId,
            cutoffHour,
            pricingSource,
          ],
        )
      ).rows[0];
      const expenses = filtered
        ? []
        : ((
            await client.query(
              `SELECT amount::text,expense_date::text AS date,allocation_method AS "allocationMethod",
            period_start::text AS "periodStart",period_end::text AS "periodEnd",category
          FROM expenses WHERE store_id=$1 AND
            ((allocation_method='ONE_TIME' AND expense_date BETWEEN $2::date AND $3::date)
             OR (allocation_method='EVEN_OVER_PERIOD' AND period_start<=$3::date AND period_end>=$2::date))`,
              [storeId, period.from, period.to],
            )
          ).rows as (ExpenseAllocation & { category: string })[]);
      await client.query('COMMIT');

      const sales = cents(facts.sales);
      const refunds = cents(facts.refunds);
      const revenue = sales - refunds;
      const missingSaleCost = facts.missing_sale_cost + facts.sales_without_lines;
      const missingRefundCost = facts.missing_refund_cost;
      const costComplete = missingSaleCost === 0 && missingRefundCost === 0;
      const cogs = costComplete ? cents(facts.sold_cost) - cents(facts.returned_cost) : null;
      const grossProfit = cogs === null ? null : revenue - cogs;
      const missingLossCost = facts.missing_movement_loss_cost + facts.missing_return_loss_cost;
      const inventoryLosses =
        filtered || missingLossCost > 0
          ? null
          : cents(facts.movement_losses) + cents(facts.return_losses);
      const operatingExpenses = expenses.reduce(
        (sum, expense) => sum + allocatedExpenseCents(expense, period.from, period.to),
        0n,
      );
      const operatingProfit =
        grossProfit === null || inventoryLosses === null
          ? null
          : grossProfit - inventoryLosses - operatingExpenses;
      const expenseByCategory = new Map<string, bigint>();
      for (const expense of expenses)
        expenseByCategory.set(
          expense.category,
          (expenseByCategory.get(expense.category) ?? 0n) +
            allocatedExpenseCents(expense, period.from, period.to),
        );
      return {
        period,
        revenue: money(revenue),
        cogs: cogs === null ? null : money(cogs),
        grossProfit: grossProfit === null ? null : money(grossProfit),
        grossMarginPercent: grossProfit === null ? null : percent(grossProfit, revenue),
        inventoryLosses: inventoryLosses === null ? null : money(inventoryLosses),
        operatingExpenses: filtered ? null : money(operatingExpenses),
        storeOperatingProfit: operatingProfit === null ? null : money(operatingProfit),
        transactionCount: facts.transactions,
        adjustments: { completedRefunds: money(refunds), refundCount: facts.refund_count },
        breakdown: {
          completedSales: money(sales),
          soldCost: money(cents(facts.sold_cost)),
          returnedCost: money(cents(facts.returned_cost)),
          movementLosses: money(cents(facts.movement_losses)),
          nonResellableReturnLosses: money(cents(facts.return_losses)),
          expensesByCategory: Object.fromEntries(
            [...expenseByCategory].map(([name, value]) => [name, money(value)]),
          ),
        },
        dataQuality: {
          costComplete,
          missingCostSaleItems: missingSaleCost,
          missingCostRefundLines: missingRefundCost,
          revenueMissingCost: money(cents(facts.missing_cost_revenue)),
          saleCostCoveragePercent: percent(sales - cents(facts.missing_cost_revenue), sales),
          lossCostComplete: missingLossCost === 0,
          missingLossMovements: facts.missing_movement_loss_cost,
          missingNonResellableReturnCosts: facts.missing_return_loss_cost,
          expenseEntries: expenses.length,
          periodExpenseEntries: expenses.filter((e) => e.allocationMethod === 'EVEN_OVER_PERIOD')
            .length,
          expenseScope: 'recorded_expenses_only' as const,
        },
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

@Controller('reports')
@UseGuards(AccessGuard)
class FinancialMetricsController {
  constructor(private readonly metrics: FinancialMetricsService) {}
  @Get('financial-summary') @Require('analytics.margin') async summary(
    @Query() input: unknown,
    @Req() req: AuthRequest,
  ) {
    if (!req.context.user.permissions.includes('expenses.read'))
      throw new ForbiddenException('Expense reporting permission is required.');
    const period = parse(periodQuery, input);
    return this.metrics.getFinancialSummary(req.context.store.id, {
      ...period,
      timezone: req.context.store.timezone,
    });
  }
}

@Module({
  imports: [AuthModule],
  controllers: [FinancialMetricsController],
  providers: [FinancialMetricsService],
  exports: [FinancialMetricsService],
})
export class FinancialMetricsModule {}
