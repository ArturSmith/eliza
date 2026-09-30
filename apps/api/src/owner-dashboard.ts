import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Module,
  Query,
  Req,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthModule } from './auth.js';
import { FinancialMetricsModule, FinancialMetricsService } from './financial-metrics.js';
import { AccessGuard, Require, parse, type AuthRequest } from './security.js';
import { Database } from './database.js';
import type { Insight } from '@eliza/contracts';
import {
  toScaled,
  fromScaled,
  type DateRange,
  type Period,
  storeToday,
  storeHour,
  periodRange,
  comparisons,
  daysBetween,
  addDays,
  percentChange,
  pointChange,
  grossMargin,
  averageBasket,
  ratio,
  buildInsights,
  whatChanged,
  ownerSummary,
  classifyProduct,
  dailyVelocity,
  daysOfStock,
  defaultThresholds,
  insightThresholds,
  type InsightFacts,
} from '@eliza/contracts';

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
const query = z
  .object({
    period: z.enum(['today', 'week', 'month', 'custom']).default('today'),
    from: date.optional(),
    to: date.optional(),
    deadDays: z.coerce.number().int().min(7).max(365).optional(),
  })
  .refine((v) => v.period !== 'custom' || (v.from && v.to), 'A custom range needs both dates')
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'Start date must not follow end date');

const num = (value: unknown) => Number(value ?? 0);
const money = (value: unknown) => String(value ?? '0');

// Receipt snapshots preserve the charged tax and category after catalog edits.
// Restock costs are allocated cumulatively so partial refunds conserve cents.
const financialEntries = `original_costs AS (
 SELECT sale_id,product_id,sum(quantity) AS quantity,sum(COALESCE(cost_total,round(cost*quantity,2))) AS cost,
 count(*) FILTER(WHERE cost_total IS NULL AND cost IS NULL) AS missing
 FROM sale_items WHERE store_id=$1 GROUP BY sale_id,product_id
), receipt_lines AS (
 SELECT s.id AS sale_id,s.created_at,(j->>'productId')::uuid AS product_id,
 COALESCE(j->>'category','Uncategorised') AS category,
 (j->>'quantity')::numeric AS quantity,(j->>'total')::numeric AS revenue
 FROM sales s CROSS JOIN LATERAL jsonb_array_elements(s.receipt->'lines') j WHERE s.store_id=$1
), snapshots AS (
 SELECT sale_id,product_id,min(category) AS category,sum(quantity) AS quantity,sum(revenue) AS revenue,min(created_at) AS created_at
 FROM receipt_lines GROUP BY sale_id,product_id
), refund_history AS (
 SELECT r.created_at,l.*,c.cost,c.quantity AS sold_quantity,COALESCE(c.missing,1) AS missing,
 COALESCE(s.category,'Uncategorised') AS category,
 COALESCE(sum(CASE WHEN l.restock THEN l.quantity ELSE 0 END) OVER(PARTITION BY l.sale_id,l.product_id ORDER BY r.created_at,r.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS prior_restock
 FROM refunds r JOIN refund_lines l ON l.refund_id=r.id AND l.store_id=r.store_id
 LEFT JOIN original_costs c ON c.sale_id=l.sale_id AND c.product_id=l.product_id
 LEFT JOIN snapshots s ON s.sale_id=l.sale_id AND s.product_id=l.product_id WHERE r.store_id=$1
), financial_entries AS (
 SELECT s.created_at,s.product_id,s.category,s.quantity,s.revenue,c.cost,COALESCE(c.missing,1) AS missing
 FROM snapshots s LEFT JOIN original_costs c ON c.sale_id=s.sale_id AND c.product_id=s.product_id
 UNION ALL
 SELECT created_at,product_id,category,0,-total,
 -COALESCE(restored_cost,CASE WHEN restock THEN round(cost*(prior_restock+quantity)/sold_quantity,2)-round(cost*prior_restock/sold_quantity,2) ELSE 0 END),missing
 FROM refund_history
)`;

type Store = { id: string; timezone: string; currency: string };

@Controller('reports')
@UseGuards(AccessGuard)
export class OwnerDashboardController {
  constructor(
    private database: Database,
    private readonly financialMetrics: FinancialMetricsService,
  ) {}

  /**
   * One request serves the whole dashboard. Every block is derived from the same
   * period and baselines so the screen can never show two different versions of a
   * number. Cost, profit and inventory valuation are omitted entirely unless the
   * caller holds `analytics.margin` - the server decides, not the UI.
   */
  @Get('owner-dashboard') @Require('analytics.view') async dashboard(
    @Query() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(query, input);
    const store = req.context.store as Store;
    const thresholdRow = (
      await this.database.pool.query(
        'SELECT no_sales_threshold_days,long_shift_threshold_hours FROM stores WHERE id=$1',
        [store.id],
      )
    ).rows[0];
    const deadDays = b.deadDays ?? thresholdRow.no_sales_threshold_days;
    const shiftHours = thresholdRow.long_shift_threshold_hours;
    const margin = req.context.user.permissions.includes('analytics.margin');
    const finances = {
      expenses: req.context.user.permissions.includes('expenses.read'),
      purchases: req.context.user.permissions.includes('purchases.read'),
    };
    const now = new Date();
    const today = storeToday(now, store.timezone);
    const hour = storeHour(now, store.timezone);
    const period = b.period as Period;
    const range: DateRange =
      period === 'custom' ? { from: b.from!, to: b.to! } : periodRange(period, today);
    const baselines = period === 'custom' ? [] : comparisons(period, range);
    const days = daysBetween(range.from, range.to);
    // Today is only part-done, so earlier days are cut at the same clock time.
    const cutoff = period === 'today' ? hour : null;

    const history = await this.history(store);
    const current = await this.totals(store, range, cutoff, margin, finances);
    const compared = [];
    for (const baseline of baselines) {
      const length = daysBetween(baseline.range.from, baseline.range.to);
      const totals = await this.totals(store, baseline.range, cutoff, margin, finances);
      // A multi-day averaging window is scaled back to one comparable period.
      const scale = baseline.key === 'weekdayAverage' ? length / 7 : length / days;
      const divisor =
        baseline.key === 'weekdayAverage' || baseline.key === 'fourWeekAverage' ? scale : 1;
      compared.push({
        ...baseline,
        available: history.days >= length,
        totals: divisor > 1 ? scaleTotals(totals, divisor) : totals,
      });
    }
    const primary = compared[0];
    const kpis = this.kpis(current, primary?.totals ?? null, margin);

    const [
      hourly,
      categories,
      products,
      inventory,
      waste,
      purchasing,
      suppliers,
      discounts,
      refunds,
      shifts,
      registers,
      employees,
      readiness,
      marginTrend,
      staleQuotes,
    ] = await Promise.all([
      this.hourly(store, range, baselines, cutoff),
      this.categories(store, range, primary?.range ?? null, margin),
      this.products(store, range, margin, deadDays, history.days),
      margin ? this.inventory(store, deadDays) : null,
      this.waste(store, range, primary?.range ?? null, margin),
      this.purchasing(store, range, primary?.range ?? null),
      this.suppliers(store, range),
      this.discounts(store, range, primary?.range ?? null),
      this.refunds(store, range, primary?.range ?? null),
      this.shifts(store, range, shiftHours),
      this.registers(store, range),
      this.employees(store, range),
      this.readiness(store),
      margin ? this.marginTrend(store, today) : null,
      // Quoted-versus-paid drift is cost information.
      margin ? this.staleQuotes(store) : [],
    ]);

    const facts = this.facts(store, {
      current,
      previous: primary?.totals ?? null,
      history,
      products,
      inventory,
      waste,
      purchasing,
      refunds,
      discounts,
      shifts,
      readiness,
      staleQuotes,
      deadDays,
      shiftHours,
    });
    const detected = buildInsights(facts);
    const insights =
      period === 'today' && margin
        ? await this.syncInsights(store, detected)
        : await this.decorateInsights(store, detected);

    const drivers: string[] = [];
    if (purchasing.costIncreases.length) drivers.push('supplier cost increases');
    if ((discounts.change ?? 0) > 5) drivers.push('higher discounting');
    if ((waste.change ?? 0) > 5) drivers.push('more waste');
    const changed = whatChanged({
      revenueChange: kpis.revenue.change,
      grossProfitChange: kpis.grossProfit.change,
      marginPointChange: kpis.grossMargin.change,
      categories: categories.rows.map((c: any) => ({
        label: c.category,
        change: c.change,
        revenue: c.revenue,
      })),
      costIncreaseCount: purchasing.costIncreases.length,
      discountChange: discounts.change,
      wasteChange: waste.change,
      refundChange: refunds.change,
    });

    return {
      period,
      range,
      today,
      hour,
      timezone: store.timezone,
      currency: store.currency,
      permissions: { margin },
      history,
      comparisons: compared.map((c) => ({
        key: c.key,
        label: c.label,
        range: c.range,
        available: c.available,
      })),
      kpis,
      financialSummary: current.financialSummary,
      pace: period === 'today' ? this.pace(current, compared, hour) : null,
      insights,
      whatChanged: changed,
      summary:
        period === 'today'
          ? null
          : ownerSummary({
              period,
              revenueChange: kpis.revenue.change,
              grossProfitChange: kpis.grossProfit.change,
              marginPointChange: kpis.grossMargin.change,
              drivers,
              wasteChange: waste.change,
            }),
      hourly,
      categories,
      products,
      inventory,
      waste,
      purchasing,
      suppliers,
      discounts,
      refunds,
      shifts,
      registers,
      employees,
      readiness,
      marginTrend,
      /** Blocks the dashboard deliberately does not show, and why. */
      unavailable: [
        ...(!finances.expenses
          ? [{ metric: 'operatingExpenses', reason: 'Requires the expenses.read permission.' }]
          : []),
        ...(margin
          ? []
          : [{ metric: 'grossProfit', reason: 'Requires the analytics.margin permission.' }]),
      ],
    };
  }

  /** Sales, units, tax, discounts, refunds and - when permitted - COGS for a window. */
  private async totals(
    store: Store,
    range: DateRange,
    cutoff: string | null,
    margin: boolean,
    finances: { expenses: boolean; purchases: boolean },
  ) {
    const row = (
      await this.database.pool.query(
        `WITH bounds AS (
 SELECT ($2::date::timestamp AT TIME ZONE $4) AS start,(($3::date+1)::timestamp AT TIME ZONE $4) AS finish
), sold AS (
 SELECT s.id,s.total,s.tax,s.discount FROM sales s CROSS JOIN bounds b
 WHERE s.store_id=$1 AND s.created_at>=b.start AND s.created_at<b.finish
 AND ($5::text IS NULL OR to_char(s.created_at AT TIME ZONE $4,'HH24')<=$5)
), items AS (
 SELECT i.quantity FROM sale_items i JOIN sold s ON s.id=i.sale_id WHERE i.store_id=$1
), returned AS (
 SELECT COALESCE(sum(l.quantity),0) AS units,count(DISTINCT r.id) AS count
 FROM refunds r JOIN refund_lines l ON l.refund_id=r.id AND l.store_id=r.store_id CROSS JOIN bounds b
 WHERE r.store_id=$1 AND r.created_at>=b.start AND r.created_at<b.finish
 AND ($5::text IS NULL OR to_char(r.created_at AT TIME ZONE $4,'HH24')<=$5)
)
SELECT (SELECT count(*) FROM sold)::text AS transactions,
 COALESCE((SELECT sum(total) FROM sold),0)::text AS "grossSales",
 COALESCE((SELECT sum(tax) FROM sold),0)::text AS tax,
 COALESCE((SELECT sum(discount) FROM sold),0)::text AS discount,
 COALESCE((SELECT sum(quantity) FROM items),0)::text AS units,
 (SELECT count FROM returned)::text AS "refundCount",
 (SELECT units FROM returned)::text AS "refundUnits",
 CASE WHEN $6 THEN (SELECT COALESCE(sum(p.total),0)::text FROM purchases p CROSS JOIN bounds b WHERE p.store_id=$1 AND p.payment_status='paid' AND p.paid_at>=b.start AND p.paid_at<b.finish AND ($5::text IS NULL OR to_char(p.paid_at AT TIME ZONE $4,'HH24')<=$5)) END AS "paidPurchases"`,
        [store.id, range.from, range.to, store.timezone, cutoff, finances.purchases],
      )
    ).rows[0];
    const canonical = await this.financialMetrics.getFinancialSummary(
      store.id,
      { from: range.from, to: range.to, timezone: store.timezone },
      { cutoffHour: cutoff === null ? undefined : Number(cutoff) },
    );
    const cents = (value: unknown) => toScaled(String(value ?? '0'), 2);
    const amount = (value: bigint) => Number(fromScaled(value, 2));
    const revenue = num(canonical.revenue);
    const cogs = margin && canonical.cogs !== null ? num(canonical.cogs) : null;
    const missing =
      canonical.dataQuality.missingCostSaleItems + canonical.dataQuality.missingCostRefundLines;
    const profit = margin && canonical.grossProfit !== null ? num(canonical.grossProfit) : null;
    const expenses = finances.expenses ? num(canonical.operatingExpenses) : null;
    return {
      transactions: num(row.transactions),
      grossSales: canonical.breakdown.completedSales,
      revenue,
      tax: num(row.tax),
      discount: num(row.discount),
      units: num(row.units),
      refunds: num(canonical.adjustments.completedRefunds),
      refundCount: num(canonical.adjustments.refundCount),
      cogs,
      operatingExpenses: expenses,
      paidPurchases: finances.purchases ? num(row.paidPurchases) : null,
      totalSpending:
        finances.expenses && finances.purchases
          ? amount(cents(canonical.operatingExpenses) + cents(row.paidPurchases))
          : null,
      netProfit:
        margin && finances.expenses && canonical.storeOperatingProfit !== null
          ? num(canonical.storeOperatingProfit)
          : null,
      netProfitRestricted: !margin || !finances.expenses,
      spendingRestricted: !finances.expenses || !finances.purchases,
      grossProfit: profit,
      grossMargin:
        margin && canonical.grossMarginPercent !== null ? num(canonical.grossMarginPercent) : null,
      averageBasket: averageBasket(num(canonical.breakdown.completedSales), num(row.transactions)),
      missingCost: missing,
      financialSummary: {
        revenue: canonical.revenue,
        cogs: margin ? canonical.cogs : null,
        grossProfit: margin ? canonical.grossProfit : null,
        grossMarginPercent: margin ? canonical.grossMarginPercent : null,
        inventoryLosses: margin ? canonical.inventoryLosses : null,
        operatingExpenses: finances.expenses ? canonical.operatingExpenses : null,
        storeOperatingProfit: margin && finances.expenses ? canonical.storeOperatingProfit : null,
        dataQuality: margin
          ? {
              costComplete: canonical.dataQuality.costComplete,
              lossCostComplete: canonical.dataQuality.lossCostComplete,
            }
          : null,
        permissions: { margin, expenses: finances.expenses },
      },
    };
  }

  private kpis(current: any, previous: any, margin: boolean) {
    const compare = (key: string, value: number | null, before: number | null) => ({
      value,
      previous: before,
      change: value === null || before === null ? null : percentChange(value, before),
      metric: key,
    });
    return {
      revenue: compare('revenue', current.revenue, previous?.revenue ?? null),
      operatingExpenses: {
        ...compare(
          'operatingExpenses',
          current.operatingExpenses,
          previous?.operatingExpenses ?? null,
        ),
        restricted: current.operatingExpenses === null,
      },
      paidPurchases: {
        ...compare('paidPurchases', current.paidPurchases, previous?.paidPurchases ?? null),
        restricted: current.paidPurchases === null,
      },
      totalSpending: {
        ...compare('totalSpending', current.totalSpending, previous?.totalSpending ?? null),
        restricted: current.spendingRestricted,
      },
      netProfit: {
        ...compare('netProfit', current.netProfit, previous?.netProfit ?? null),
        restricted: current.netProfitRestricted,
      },
      grossProfit: margin
        ? compare('grossProfit', current.grossProfit, previous?.grossProfit ?? null)
        : { value: null, previous: null, change: null, metric: 'grossProfit', restricted: true },
      grossMargin: {
        value: current.grossMargin,
        previous: previous?.grossMargin ?? null,
        // Margin moves in percentage points, not percent of a percent.
        change: pointChange(current.grossMargin, previous?.grossMargin ?? null),
        unit: 'points',
        metric: 'grossMargin',
        restricted: !margin,
      },
      transactions: compare('transactions', current.transactions, previous?.transactions ?? null),
      averageBasket: compare(
        'averageBasket',
        current.averageBasket,
        previous?.averageBasket ?? null,
      ),
      refunds: compare('refunds', current.refunds, previous?.refunds ?? null),
      discounts: compare('discounts', current.discount, previous?.discount ?? null),
      units: compare('units', current.units, previous?.units ?? null),
    };
  }

  /** Sales pace against the same clock time on comparable days. */
  private pace(current: any, compared: any[], hour: string) {
    const baseline = compared.find((c) => c.key === 'weekdayAverage') ?? compared[0];
    if (!baseline?.available) return null;
    return {
      hour,
      label: baseline.label,
      current: current.revenue,
      baseline: baseline.totals.revenue,
      change: percentChange(current.revenue, baseline.totals.revenue),
    };
  }

  /** Hourly sales for the day, with the comparable-day average overlaid. */
  private async hourly(
    store: Store,
    range: DateRange,
    baselines: { key: string; range: DateRange }[],
    cutoff: string | null,
  ) {
    const overlay = baselines.find((c) => c.key === 'weekdayAverage')?.range;
    const rows = (
      await this.database.pool.query(
        `SELECT to_char(s.created_at AT TIME ZONE $4,'HH24') AS hour,
 sum(s.total)::text AS total,count(*)::text AS transactions
 FROM sales s WHERE s.store_id=$1
 AND s.created_at>=($2::date::timestamp AT TIME ZONE $4)
 AND s.created_at<(($3::date+1)::timestamp AT TIME ZONE $4)
 GROUP BY 1 ORDER BY 1`,
        [store.id, range.from, range.to, store.timezone],
      )
    ).rows;
    let comparison: Record<string, number> = {};
    if (overlay) {
      const weekdays = (
        await this.database.pool.query(
          `SELECT to_char(s.created_at AT TIME ZONE $4,'HH24') AS hour,
 sum(s.total)/GREATEST(count(DISTINCT (s.created_at AT TIME ZONE $4)::date),1) AS average
 FROM sales s WHERE s.store_id=$1
 AND s.created_at>=($2::date::timestamp AT TIME ZONE $4)
 AND s.created_at<(($3::date+1)::timestamp AT TIME ZONE $4)
 AND extract(isodow from s.created_at AT TIME ZONE $4)=extract(isodow from $5::date)
 GROUP BY 1`,
          [store.id, overlay.from, overlay.to, store.timezone, range.from],
        )
      ).rows;
      comparison = Object.fromEntries(weekdays.map((r: any) => [r.hour, num(r.average)]));
    }
    const byHour = new Map(rows.map((r: any) => [r.hour, r]));
    return Array.from({ length: 24 }, (_, i) => {
      const key = String(i).padStart(2, '0');
      const row: any = byHour.get(key);
      return {
        hour: key,
        total: row ? num(row.total) : 0,
        transactions: row ? num(row.transactions) : 0,
        comparison: comparison[key] ?? null,
        elapsed: cutoff === null || key <= cutoff,
      };
    });
  }

  /** Category revenue, profit and share, with growth against the baseline window. */
  private async categories(
    store: Store,
    range: DateRange,
    previous: DateRange | null,
    margin: boolean,
  ) {
    const rows = (
      await this.database.pool.query(
        `WITH ${financialEntries}, windows AS (
 SELECT 'current' AS phase,$2::date AS from_day,$3::date AS to_day
 UNION ALL SELECT 'previous',$5::date,$6::date WHERE $5 IS NOT NULL
), lines AS (
 SELECT w.phase,e.* FROM windows w JOIN financial_entries e
 ON e.created_at>=(w.from_day::timestamp AT TIME ZONE $4)
 AND e.created_at<((w.to_day+1)::timestamp AT TIME ZONE $4)
)
SELECT phase,category,sum(revenue)::text AS revenue,sum(quantity)::text AS units,
 CASE WHEN $7 AND sum(missing)=0 THEN (sum(revenue)-sum(cost))::text END AS "grossProfit"
 FROM lines GROUP BY phase,category ORDER BY sum(revenue) DESC`,
        [
          store.id,
          range.from,
          range.to,
          store.timezone,
          previous?.from ?? null,
          previous?.to ?? null,
          margin,
        ],
      )
    ).rows;
    const before = new Map(
      rows.filter((r: any) => r.phase === 'previous').map((r: any) => [r.category, r]),
    );
    const currentRows = rows.filter((r: any) => r.phase === 'current');
    const total = Number(
      fromScaled(
        currentRows.reduce((sum: bigint, r: any) => sum + toScaled(r.revenue, 2), 0n),
        2,
      ),
    );
    return {
      total,
      rows: currentRows.map((r: any) => {
        const prior: any = before.get(r.category);
        const profit = r.grossProfit === null ? null : num(r.grossProfit);
        return {
          category: r.category,
          revenue: money(r.revenue),
          units: money(r.units),
          grossProfit: r.grossProfit,
          margin: grossMargin(profit, num(r.revenue)),
          share: ratio(num(r.revenue), total),
          change: prior ? percentChange(num(r.revenue), num(prior.revenue)) : null,
        };
      }),
    };
  }

  /**
   * Product rankings and portfolio classification in one pass. Velocity uses the
   * selected window; dead-stock uses the product's true last sale date.
   */
  private async products(
    store: Store,
    range: DateRange,
    margin: boolean,
    deadDays: number,
    historyDays: number,
  ) {
    const days = daysBetween(range.from, range.to);
    const rows = (
      await this.database.pool.query(
        `WITH ${financialEntries}, bounds AS (
 SELECT ($2::date::timestamp AT TIME ZONE $4) AS start,(($3::date+1)::timestamp AT TIME ZONE $4) AS finish
), sold AS (
 SELECT COALESCE(p.base_product_id,f.product_id) AS product_id,sum(f.quantity) AS units,sum(f.revenue) AS revenue,sum(f.cost) AS cost,sum(f.missing) AS missing
 FROM financial_entries f JOIN products p ON p.id=f.product_id AND p.store_id=$1 CROSS JOIN bounds b
 WHERE f.created_at>=b.start AND f.created_at<b.finish GROUP BY 1
), returned AS (
 SELECT COALESCE(p.base_product_id,l.product_id) AS product_id,sum(l.total) AS total,sum(l.quantity) AS units
 FROM refund_lines l JOIN refunds r ON r.id=l.refund_id AND r.store_id=l.store_id CROSS JOIN bounds b
 JOIN products p ON p.id=l.product_id AND p.store_id=l.store_id
 WHERE l.store_id=$1 AND r.created_at>=b.start AND r.created_at<b.finish GROUP BY 1
), last_sale AS (
 SELECT COALESCE(p.base_product_id,i.product_id) AS product_id,max(s.created_at) AS sold_at FROM sale_items i
 JOIN sales s ON s.id=i.sale_id AND s.store_id=$1 JOIN products p ON p.id=i.product_id AND p.store_id=i.store_id
 WHERE i.store_id=$1 GROUP BY 1
), week AS (
 SELECT COALESCE(p.base_product_id,i.product_id) AS product_id,sum(i.quantity) AS units,sum(i.total) AS revenue
 FROM sale_items i JOIN sales s ON s.id=i.sale_id AND s.store_id=$1
 JOIN products p ON p.id=i.product_id AND p.store_id=i.store_id
 WHERE i.store_id=$1 AND s.created_at>=now()-interval '7 days' GROUP BY 1
)
SELECT p.id,p.name,p.sku,p.category,p.unit,(p.stock+COALESCE((SELECT sum(child.stock) FROM products child WHERE child.store_id=p.store_id AND child.base_product_id=p.id),0))::text AS stock,p.min_stock::text AS "minStock",
 p.price::text,p.tax_rate::text AS "taxRate",p.active,
 ((now() AT TIME ZONE $4)::date-(p.created_at AT TIME ZONE $4)::date)::int AS "productAgeDays",
 CASE WHEN $5 THEN p.cost::text END AS cost,
 COALESCE(sold.units,0)::text AS units,COALESCE(sold.revenue,0)::text AS revenue,
 COALESCE(returned.total,0)::text AS refunds,
 COALESCE(week.units,0)::text AS "weeklyUnits",COALESCE(week.revenue,0)::text AS "weeklyRevenue",
 CASE WHEN $5 AND COALESCE(sold.missing,0)=0 THEN COALESCE(sold.cost,0)::text END AS "soldCost",
 CASE WHEN last_sale.sold_at IS NULL THEN NULL
  ELSE ((now() AT TIME ZONE $4)::date-(last_sale.sold_at AT TIME ZONE $4)::date)::int END AS "daysSinceLastSale"
 FROM products p
 LEFT JOIN sold ON sold.product_id=p.id
 LEFT JOIN returned ON returned.product_id=p.id
 LEFT JOIN last_sale ON last_sale.product_id=p.id
 LEFT JOIN week ON week.product_id=p.id
 WHERE p.store_id=$1 AND p.base_product_id IS NULL`,
        [store.id, range.from, range.to, store.timezone, margin],
      )
    ).rows;

    const enriched = rows.map((r: any) => {
      const revenue = num(r.revenue);
      const soldCost = r.soldCost === null ? null : num(r.soldCost);
      const profit =
        soldCost === null
          ? null
          : Number(fromScaled(toScaled(r.revenue, 2) - toScaled(r.soldCost, 2), 2));
      const netUnitPrice = num(r.price);
      const unitMargin =
        margin && r.cost !== null && netUnitPrice > 0
          ? ((netUnitPrice - num(r.cost)) / netUnitPrice) * 100
          : null;
      const velocity = dailyVelocity(r.units, days);
      return {
        id: r.id,
        name: r.name,
        sku: r.sku,
        category: r.category ?? 'Uncategorised',
        unit: r.unit,
        active: r.active,
        stock: r.stock,
        minStock: r.minStock,
        price: r.price,
        cost: r.cost,
        units: r.units,
        revenue: r.revenue,
        refunds: r.refunds,
        weeklyUnits: r.weeklyUnits,
        weeklyRevenue: r.weeklyRevenue,
        grossProfit: profit,
        margin: grossMargin(profit, revenue),
        unitMargin,
        velocity,
        daysOfStock: daysOfStock(r.stock, velocity),
        daysSinceLastSale: r.daysSinceLastSale,
        productAgeDays: r.productAgeDays,
        portfolio: classifyProduct(
          {
            units: r.units,
            revenue: r.revenue,
            grossProfit: profit === null ? null : String(profit),
            margin: unitMargin,
            stock: r.stock,
            daysSinceLastSale: r.daysSinceLastSale,
            historyDays,
            productAgeDays: r.productAgeDays,
          },
          { ...defaultThresholds, deadDays },
        ),
      };
    });

    const top = (key: string, count = 10) =>
      [...enriched]
        .filter((p: any) => num(p[key]) > 0)
        .sort((a: any, b: any) => num(b[key]) - num(a[key]))
        .slice(0, count);
    const buckets: Record<string, number> = {};
    for (const p of enriched) buckets[p.portfolio] = (buckets[p.portfolio] ?? 0) + 1;
    const totalProfit = enriched.reduce((s, p) => s + (p.grossProfit ?? 0), 0);
    const byProfit = [...enriched]
      .filter((p) => (p.grossProfit ?? 0) > 0)
      .sort((a, b) => (b.grossProfit ?? 0) - (a.grossProfit ?? 0));
    let running = 0;
    let vital = 0;
    for (const p of byProfit) {
      if (running >= totalProfit * 0.8) break;
      running += p.grossProfit ?? 0;
      vital += 1;
    }

    return {
      days,
      byRevenue: top('revenue'),
      byUnits: top('units'),
      byProfit: margin
        ? [...enriched]
            .filter((p) => p.grossProfit !== null)
            .sort((a, b) => (b.grossProfit ?? 0) - (a.grossProfit ?? 0))
            .slice(0, 10)
        : [],
      byRefunds: top('refunds', 5),
      declining: [],
      lowMargin: margin
        ? enriched
            .filter((p) => p.unitMargin !== null && p.unitMargin < 5 && p.active)
            .sort((a, b) => (a.unitMargin ?? 0) - (b.unitMargin ?? 0))
            .slice(0, 10)
        : [],
      runningOut: enriched
        .filter(
          (p) =>
            p.active && p.daysOfStock !== null && p.daysOfStock <= insightThresholds.runningOutDays,
        )
        .sort((a, b) => (a.daysOfStock ?? 0) - (b.daysOfStock ?? 0))
        .slice(0, 10),
      portfolio: {
        buckets,
        deadDays,
        /** Products generating the first 80% of gross profit. */
        vitalFew: margin ? { count: vital, share: ratio(running, totalProfit) } : null,
      },
      classified: enriched.filter((p) => p.portfolio !== 'unclassified').length,
      all: enriched.length,
    };
  }

  /** Stock value, cover and dead stock. Only reachable with margin permission. */
  private async inventory(store: Store, deadDays: number) {
    const row = (
      await this.database.pool.query(
        `WITH last_sale AS (
 SELECT i.product_id,max(s.created_at) AS sold_at FROM sale_items i
 JOIN sales s ON s.id=i.sale_id AND s.store_id=$1 WHERE i.store_id=$1 GROUP BY i.product_id
), stocked AS (
 SELECT p.id,p.stock,p.cost,p.min_stock,p.active,l.sold_at,p.created_at,
 COALESCE((SELECT sum(round(b.quantity*b.unit_cost,2)) FROM stock_batches b WHERE b.product_id=p.id AND b.store_id=$1 AND b.quantity>0),0) AS batch_value,
 EXISTS(SELECT 1 FROM stock_batches b WHERE b.product_id=p.id AND b.store_id=$1 AND b.quantity>0 AND b.unit_cost=0) AS has_missing_batch_cost,
 (p.stock>0) AS holds_stock,
 (CASE WHEN l.sold_at IS NULL THEN p.created_at ELSE l.sold_at END) < (($3::date::timestamp AT TIME ZONE $4) - ($2||' days')::interval) AS stale
 FROM products p LEFT JOIN last_sale l ON l.product_id=p.id WHERE p.store_id=$1
)
SELECT
 COALESCE(sum(batch_value) FILTER(WHERE holds_stock),0)::text AS value,
 count(*) FILTER(WHERE holds_stock)::text AS "inStock",
 count(*) FILTER(WHERE active AND stock<=0)::text AS "outOfStock",
 count(*) FILTER(WHERE active AND stock>0 AND stock<=min_stock)::text AS "lowStock",
 count(*) FILTER(WHERE active AND holds_stock AND stale)::text AS "deadCount",
 COALESCE(sum(stock) FILTER(WHERE active AND holds_stock AND stale),0)::text AS "deadUnits",
 count(*) FILTER(WHERE active AND holds_stock AND stale AND has_missing_batch_cost)::text AS "deadMissingCostProducts",
 COALESCE(sum(batch_value) FILTER(WHERE active AND holds_stock AND stale),0)::text AS "deadValue",
 (SELECT count(*) FROM stock_batches b JOIN products p ON p.id=b.product_id AND p.store_id=b.store_id
  LEFT JOIN last_sale l ON l.product_id=p.id WHERE b.store_id=$1 AND p.active AND p.stock>0 AND b.quantity>0
  AND b.cost_source='legacy_estimate' AND COALESCE(l.sold_at,p.created_at)<(($3::date::timestamp AT TIME ZONE $4)-($2||' days')::interval))::int AS "deadEstimatedBatches",
 count(*) FILTER(WHERE holds_stock AND cost=0)::text AS "missingCost",
 COALESCE(sum(batch_value) FILTER(WHERE holds_stock AND cost=0),0)::text AS "uncostedValue"
 FROM stocked`,
        [store.id, String(deadDays), storeToday(new Date(), store.timezone), store.timezone],
      )
    ).rows[0];
    const byCategory = (
      await this.database.pool.query(
        `SELECT COALESCE(category,'Uncategorised') AS category,
 sum(COALESCE((SELECT sum(round(b.quantity*b.unit_cost,2)) FROM stock_batches b WHERE b.product_id=products.id AND b.store_id=$1),0))::text AS value,count(*)::text AS products
 FROM products WHERE store_id=$1 AND stock>0 GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
        [store.id],
      )
    ).rows;
    return {
      value: money(row.value),
      inStock: num(row.inStock),
      outOfStock: num(row.outOfStock),
      lowStock: num(row.lowStock),
      dead: {
        count: num(row.deadCount),
        units: money(row.deadUnits),
        missingCostProducts: num(row.deadMissingCostProducts),
        value: money(row.deadValue),
        days: deadDays,
        estimated: num(row.deadEstimatedBatches) > 0,
      },
      // Missing cost means the valuation is understated, so it is stated outright.
      missingCost: num(row.missingCost),
      byCategory,
    };
  }

  /** Operational waste uses the recorded batch-cost snapshot, never today's catalog cost. */
  private async waste(store: Store, range: DateRange, previous: DateRange | null, margin: boolean) {
    const rows = (
      await this.database.pool.query(
        `WITH windows AS (
 SELECT 'current' AS phase,$2::date AS from_day,$3::date AS to_day
 UNION ALL SELECT 'previous',$5::date,$6::date WHERE $5 IS NOT NULL
)
SELECT w.phase,m.reason,COALESCE(p.category,'Uncategorised') AS category,
 sum(abs(m.quantity))::text AS units,
 sum(m.cost_total)::text AS value,
 count(*) FILTER(WHERE m.cost_total IS NULL)::int AS missing
 FROM windows w JOIN movements m ON m.store_id=$1
 AND m.created_at>=(w.from_day::timestamp AT TIME ZONE $4)
 AND m.created_at<((w.to_day+1)::timestamp AT TIME ZONE $4)
 JOIN products p ON p.id=m.product_id AND p.store_id=$1
 WHERE m.reason IN ('damaged','expired','internal_use') AND m.quantity<0
 GROUP BY w.phase,m.reason,category`,
        [
          store.id,
          range.from,
          range.to,
          store.timezone,
          previous?.from ?? null,
          previous?.to ?? null,
        ],
      )
    ).rows;
    const sum = (phase: string) => {
      const entries = rows.filter((r: any) => r.phase === phase);
      return entries.some((r: any) => r.missing > 0)
        ? null
        : entries.reduce((s: number, r: any) => s + num(r.value), 0);
    };
    const current = sum('current');
    const before = previous ? sum('previous') : null;
    const byReason: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    for (const r of rows.filter((r: any) => r.phase === 'current')) {
      if (r.missing === 0) {
        byReason[r.reason] = (byReason[r.reason] ?? 0) + num(r.value);
        byCategory[r.category] = (byCategory[r.category] ?? 0) + num(r.value);
      }
    }
    return {
      value: current,
      previous: before,
      change: before === null || current === null ? null : percentChange(current, before),
      byReason,
      byCategory: Object.entries(byCategory)
        .map(([category, value]) => ({
          category,
          value,
          share: current === null ? null : ratio(value, current),
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8),
      available: margin,
    };
  }

  /** Purchase spend plus per-product cost movement between the two most recent receipts. */
  private async purchasing(store: Store, range: DateRange, previous: DateRange | null) {
    const spend = (
      await this.database.pool.query(
        `WITH windows AS (
 SELECT 'current' AS phase,$2::date AS from_day,$3::date AS to_day
 UNION ALL SELECT 'previous',$5::date,$6::date WHERE $5 IS NOT NULL
)
SELECT w.phase,COALESCE(sum(g.total),0)::text AS received,count(g.id)::text AS deliveries
 FROM windows w LEFT JOIN goods_receipts g ON g.store_id=$1
 AND g.created_at>=(w.from_day::timestamp AT TIME ZONE $4)
 AND g.created_at<((w.to_day+1)::timestamp AT TIME ZONE $4)
 GROUP BY w.phase`,
        [
          store.id,
          range.from,
          range.to,
          store.timezone,
          previous?.from ?? null,
          previous?.to ?? null,
        ],
      )
    ).rows;
    const outstanding = (
      await this.database.pool.query(
        `SELECT COALESCE(sum((l.ordered_quantity-l.received_quantity)*l.unit_cost),0)::text AS value,
 count(DISTINCT o.id)::text AS orders
 FROM purchases o JOIN purchase_lines l ON l.purchase_id=o.id AND l.store_id=o.store_id
 WHERE o.store_id=$1 AND o.status IN ('ordered','partially_received')`,
        [store.id],
      )
    ).rows[0];
    // Compare each product's two most recent received unit costs.
    const changes = (
      await this.database.pool.query(
        `WITH receipts AS (
 SELECT l.product_id,l.unit_cost,g.created_at,
 row_number() OVER(PARTITION BY l.product_id ORDER BY g.created_at DESC) AS rank
 FROM goods_receipt_lines l JOIN goods_receipts g ON g.id=l.receipt_id AND g.store_id=l.store_id
 WHERE l.store_id=$1
), paired AS (
 SELECT c.product_id,c.unit_cost AS current_cost,p.unit_cost AS previous_cost,c.created_at
 FROM receipts c JOIN receipts p ON p.product_id=c.product_id AND p.rank=2
 WHERE c.rank=1 AND p.unit_cost>0 AND c.unit_cost<>p.unit_cost
), week AS (
 SELECT i.product_id,sum(i.quantity) AS units FROM sale_items i
 JOIN sales s ON s.id=i.sale_id AND s.store_id=$1
 WHERE i.store_id=$1 AND s.created_at>=now()-interval '7 days' GROUP BY i.product_id
)
SELECT pr.id,pr.name,pr.sku,pr.price::text,pr.cost::text,
 paired.previous_cost::text AS "previousCost",paired.current_cost::text AS "currentCost",
 round((paired.current_cost-paired.previous_cost)*100/paired.previous_cost,2)::float AS percent,
 paired.created_at AS "changedAt",
 COALESCE(week.units,0)::text AS "weeklyUnits",
 (pr.price<=paired.previous_cost*pr.price/NULLIF(paired.previous_cost,0)) AS unchanged
 FROM paired JOIN products pr ON pr.id=paired.product_id AND pr.store_id=$1
 LEFT JOIN week ON week.product_id=paired.product_id
 ORDER BY abs(paired.current_cost-paired.previous_cost)/paired.previous_cost DESC LIMIT 50`,
        [store.id],
      )
    ).rows;
    const current = spend.find((r: any) => r.phase === 'current');
    const before = spend.find((r: any) => r.phase === 'previous');
    const increases = changes.filter(
      (r: any) => r.percent >= insightThresholds.costIncreasePercent,
    );
    return {
      received: money(current?.received),
      deliveries: num(current?.deliveries),
      change: before ? percentChange(num(current?.received), num(before.received)) : null,
      outstanding: { value: money(outstanding.value), orders: num(outstanding.orders) },
      costIncreases: increases.map((r: any) => ({
        id: r.id,
        label: r.name,
        sku: r.sku,
        previousCost: r.previousCost,
        currentCost: r.currentCost,
        percent: r.percent,
        price: r.price,
        weeklyUnits: r.weeklyUnits,
        // The retail price has not been raised since the cost went up.
        priceUnchanged: num(r.price) > 0 && num(r.cost) >= num(r.currentCost),
      })),
      costDecreases: changes
        .filter((r: any) => r.percent <= -insightThresholds.costIncreasePercent)
        .map((r: any) => ({
          id: r.id,
          label: r.name,
          previousCost: r.previousCost,
          currentCost: r.currentCost,
          percent: r.percent,
        })),
    };
  }

  private async suppliers(store: Store, range: DateRange) {
    const rows = (
      await this.database.pool.query(
        `SELECT s.id,s.name,COALESCE(sum(g.total),0)::text AS spend,count(g.id)::text AS deliveries,
 (SELECT count(DISTINCT l.product_id) FROM purchase_lines l JOIN purchases o ON o.id=l.purchase_id
  WHERE o.supplier_id=s.id AND o.store_id=$1)::text AS products
 FROM suppliers s
 LEFT JOIN purchases o ON o.supplier_id=s.id AND o.store_id=$1
 LEFT JOIN goods_receipts g ON g.purchase_id=o.id AND g.store_id=$1
 AND g.created_at>=($2::date::timestamp AT TIME ZONE $4)
 AND g.created_at<(($3::date+1)::timestamp AT TIME ZONE $4)
 WHERE s.store_id=$1 GROUP BY s.id,s.name ORDER BY 3 DESC`,
        [store.id, range.from, range.to, store.timezone],
      )
    ).rows;
    const total = rows.reduce((s: number, r: any) => s + num(r.spend), 0);
    return {
      total,
      rows: rows
        .filter((r: any) => num(r.spend) > 0)
        .map((r: any) => ({
          id: r.id,
          name: r.name,
          spend: r.spend,
          deliveries: num(r.deliveries),
          products: num(r.products),
          share: ratio(num(r.spend), total),
        })),
    };
  }

  private async discounts(store: Store, range: DateRange, previous: DateRange | null) {
    const rows = (
      await this.database.pool.query(
        `WITH windows AS (
 SELECT 'current' AS phase,$2::date AS from_day,$3::date AS to_day
 UNION ALL SELECT 'previous',$5::date,$6::date WHERE $5 IS NOT NULL
)
SELECT w.phase,COALESCE(sum(s.discount),0)::text AS value,
 COALESCE(sum(s.total),0)::text AS sales,
 count(*) FILTER(WHERE s.discount>0)::text AS "discountedSales",
 COALESCE(s2.name,'Unknown') AS cashier,s.employee_id AS "employeeId"
 FROM windows w LEFT JOIN sales s ON s.store_id=$1
 AND s.created_at>=(w.from_day::timestamp AT TIME ZONE $4)
 AND s.created_at<((w.to_day+1)::timestamp AT TIME ZONE $4)
 LEFT JOIN employees s2 ON s2.id=s.employee_id AND s2.store_id=$1
 GROUP BY w.phase,s2.name,s.employee_id`,
        [
          store.id,
          range.from,
          range.to,
          store.timezone,
          previous?.from ?? null,
          previous?.to ?? null,
        ],
      )
    ).rows;
    const total = (phase: string) =>
      rows.filter((r: any) => r.phase === phase).reduce((s: number, r: any) => s + num(r.value), 0);
    const sales = rows
      .filter((r: any) => r.phase === 'current')
      .reduce((s: number, r: any) => s + num(r.sales), 0);
    const current = total('current');
    const before = previous ? total('previous') : null;
    return {
      value: current,
      previous: before,
      change: before === null ? null : percentChange(current, before),
      rate: ratio(current, sales),
      byCashier: rows
        .filter((r: any) => r.phase === 'current' && num(r.value) > 0)
        .map((r: any) => ({
          id: r.employeeId,
          name: r.cashier,
          value: r.value,
          rate: ratio(num(r.value), num(r.sales)),
        }))
        .sort((a: any, b: any) => num(b.value) - num(a.value)),
    };
  }

  private async refunds(store: Store, range: DateRange, previous: DateRange | null) {
    const rows = (
      await this.database.pool.query(
        `WITH windows AS (
 SELECT 'current' AS phase,$2::date AS from_day,$3::date AS to_day
 UNION ALL SELECT 'previous',$5::date,$6::date WHERE $5 IS NOT NULL
), sales_by AS (
 SELECT w.phase,s.device_id,s.employee_id,sum(s.total) AS sales
 FROM windows w JOIN sales s ON s.store_id=$1
 AND s.created_at>=(w.from_day::timestamp AT TIME ZONE $4)
 AND s.created_at<((w.to_day+1)::timestamp AT TIME ZONE $4)
 GROUP BY w.phase,s.device_id,s.employee_id
), refunds_by AS (
 SELECT w.phase,r.device_id,r.employee_id,sum(r.total) AS refunds,count(*) AS count
 FROM windows w JOIN refunds r ON r.store_id=$1
 AND r.created_at>=(w.from_day::timestamp AT TIME ZONE $4)
 AND r.created_at<((w.to_day+1)::timestamp AT TIME ZONE $4)
 GROUP BY w.phase,r.device_id,r.employee_id
)
SELECT COALESCE(s.phase,f.phase) AS phase,
 COALESCE(d.name,'Unknown register') AS register,COALESCE(e.name,'Unknown') AS cashier,
 COALESCE(s.device_id,f.device_id) AS "deviceId",
 COALESCE(s.sales,0)::text AS sales,COALESCE(f.refunds,0)::text AS refunds,
 COALESCE(f.count,0)::text AS count
 FROM sales_by s FULL JOIN refunds_by f
 ON f.phase=s.phase AND f.device_id=s.device_id AND f.employee_id=s.employee_id
 LEFT JOIN device_records d ON d.id=COALESCE(s.device_id,f.device_id) AND d.store_id=$1
 LEFT JOIN employees e ON e.id=COALESCE(s.employee_id,f.employee_id) AND e.store_id=$1`,
        [
          store.id,
          range.from,
          range.to,
          store.timezone,
          previous?.from ?? null,
          previous?.to ?? null,
        ],
      )
    ).rows;
    const phase = (name: string) => rows.filter((r: any) => r.phase === name);
    const sumBy = (list: any[], key: string) =>
      list.reduce((s: number, r: any) => s + num(r[key]), 0);
    const current = sumBy(phase('current'), 'refunds');
    const before = previous ? sumBy(phase('previous'), 'refunds') : null;
    const sales = sumBy(phase('current'), 'sales');
    const rate = ratio(current, sales);
    const byRegister = new Map<string, { label: string; sales: number; refunds: number }>();
    for (const r of phase('current')) {
      const entry = byRegister.get(r.register) ?? { label: r.register, sales: 0, refunds: 0 };
      entry.sales += num(r.sales);
      entry.refunds += num(r.refunds);
      byRegister.set(r.register, entry);
    }
    const registers = [...byRegister.entries()].map(([id, v]) => ({
      id,
      label: v.label,
      rate: ratio(v.refunds, v.sales),
      refunds: v.refunds,
    }));
    return {
      value: current,
      previous: before,
      change: before === null ? null : percentChange(current, before),
      count: sumBy(phase('current'), 'count'),
      rate,
      registers,
      // A register only stands out against the store's own normal behaviour.
      outliers: registers.filter(
        (r) =>
          rate !== null &&
          r.rate !== null &&
          r.rate >= insightThresholds.refundRateFloor &&
          r.rate >= rate * insightThresholds.refundRateMultiplier,
      ),
    };
  }

  private async shifts(store: Store, range: DateRange, thresholdHours: number) {
    const rows = (
      await this.database.pool.query(
        `SELECT h.id,h.status,h.opened_at AS "openedAt",h.closed_at AS "closedAt",
 h.expected_cash::text AS expected,h.counted_cash::text AS counted,h.difference::text AS difference,
 e.name AS cashier,d.name AS register,
 COALESCE((SELECT sum(total) FROM sales WHERE shift_id=h.id AND store_id=$1),0)::text AS sales,
 COALESCE((SELECT count(*) FROM sales WHERE shift_id=h.id AND store_id=$1),0)::text AS transactions,
 EXTRACT(epoch FROM (COALESCE(h.closed_at,now())-h.opened_at))/3600 AS hours
 FROM shifts h
 JOIN employees e ON e.id=h.employee_id AND e.store_id=$1
 JOIN device_records d ON d.id=h.device_id AND d.store_id=$1
 WHERE h.store_id=$1
 AND ((h.opened_at<(($3::date+1)::timestamp AT TIME ZONE $4) AND COALESCE(h.closed_at,now())>=($2::date::timestamp AT TIME ZONE $4)))
 ORDER BY h.opened_at DESC LIMIT 50`,
        [store.id, range.from, range.to, store.timezone],
      )
    ).rows;
    const open = await this.database.pool.query(
      "SELECT count(*)::int AS count FROM shifts WHERE store_id=$1 AND status='open'",
      [store.id],
    );
    return {
      rows,
      open: open.rows[0].count as number,
      closed: rows.filter((r: any) => r.status === 'closed').length,
      differences: rows.filter((r: any) => r.difference !== null && num(r.difference) !== 0),
      longOpen: rows.filter((r: any) => r.status === 'open' && num(r.hours) >= thresholdHours),
    };
  }

  private async registers(store: Store, range: DateRange) {
    return (
      await this.database.pool.query(
        `SELECT d.id,d.name,
 COALESCE(sum(s.total),0)::text AS revenue,count(s.id)::text AS transactions,
 CASE WHEN count(s.id)>0 THEN round(sum(s.total)/count(s.id),2)::text END AS "averageBasket",
 COALESCE(sum(s.discount),0)::text AS discounts
 FROM devices d LEFT JOIN sales s ON s.device_id=d.id AND s.store_id=$1
 AND s.created_at>=($2::date::timestamp AT TIME ZONE $4)
 AND s.created_at<(($3::date+1)::timestamp AT TIME ZONE $4)
 WHERE d.store_id=$1 GROUP BY d.id,d.name HAVING count(s.id)>0 ORDER BY 3 DESC`,
        [store.id, range.from, range.to, store.timezone],
      )
    ).rows;
  }

  /** Operational counts only - deliberately not a performance ranking. */
  private async employees(store: Store, range: DateRange) {
    return (
      await this.database.pool.query(
        `SELECT e.id,e.name,
 COALESCE(sum(s.total),0)::text AS revenue,count(s.id)::text AS transactions,
 COALESCE(sum(s.discount),0)::text AS discounts,
 COALESCE((SELECT sum(r.total) FROM refunds r WHERE r.employee_id=e.id AND r.store_id=$1
  AND r.created_at>=($2::date::timestamp AT TIME ZONE $4)
  AND r.created_at<(($3::date+1)::timestamp AT TIME ZONE $4)),0)::text AS refunds,
 COALESCE((SELECT sum(h.difference) FROM shifts h WHERE h.employee_id=e.id AND h.store_id=$1
  AND h.closed_at>=($2::date::timestamp AT TIME ZONE $4)
  AND h.closed_at<(($3::date+1)::timestamp AT TIME ZONE $4)),0)::text AS "cashDifference"
 FROM employees e LEFT JOIN sales s ON s.employee_id=e.id AND s.store_id=$1
 AND s.created_at>=($2::date::timestamp AT TIME ZONE $4)
 AND s.created_at<(($3::date+1)::timestamp AT TIME ZONE $4)
 WHERE e.store_id=$1 GROUP BY e.id,e.name HAVING count(s.id)>0 ORDER BY 4 DESC`,
        [store.id, range.from, range.to, store.timezone],
      )
    ).rows;
  }

  /** Catalogue completeness, so onboarding gaps are visible rather than silent. */
  private async readiness(store: Store) {
    const row = (
      await this.database.pool.query(
        `SELECT count(*)::text AS products,
 count(*) FILTER(WHERE active)::text AS active,
 count(*) FILTER(WHERE cost=0)::text AS "missingCost",
 count(*) FILTER(WHERE category='' OR category IS NULL)::text AS "missingCategory",
 count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM barcodes b WHERE b.product_id=p.id) AND (plu IS NULL OR plu=''))::text AS "missingCode",
 count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM movements m WHERE m.product_id=p.id AND m.reason='opening_balance'))::text AS uncounted
 FROM products p WHERE p.store_id=$1 AND p.base_product_id IS NULL`,
        [store.id],
      )
    ).rows[0];
    const products = num(row.products);
    const incomplete = new Set<string>();
    const ready =
      products - Math.max(num(row.missingCost), num(row.missingCategory), num(row.missingCode));
    return {
      products,
      active: num(row.active),
      ready: Math.max(ready, 0),
      readiness: products > 0 ? Math.round((Math.max(ready, 0) / products) * 100) : null,
      missingCost: num(row.missingCost),
      missingCategory: num(row.missingCategory),
      missingCode: num(row.missingCode),
      uncounted: num(row.uncounted),
      incomplete: incomplete.size,
    };
  }

  /**
   * Quoted supplier prices the most recent invoice contradicts. Both sides are
   * normalised to one selling unit before comparison, so differing pack sizes do
   * not register as a price change.
   */
  private async staleQuotes(store: any) {
    return (
      await this.database.pool.query(
        `SELECT sp.id,sp.product_id AS "productId",p.name AS label,s.name AS "supplierName",
         (sp.pack_cost/sp.pack_size)::numeric(14,4)::text AS "quotedCost",
         h.unit_cost::text AS "paidCost",
         ((h.unit_cost-(sp.pack_cost/sp.pack_size))/NULLIF(sp.pack_cost/sp.pack_size,0)*100)::float AS percent
         FROM supplier_products sp
         JOIN products p ON p.id=sp.product_id
         JOIN suppliers s ON s.id=sp.supplier_id
         JOIN LATERAL (
           SELECT l.unit_cost FROM goods_receipt_lines l
           JOIN goods_receipts r ON r.id=l.receipt_id AND r.store_id=l.store_id
           JOIN purchases pu ON pu.id=r.purchase_id AND pu.store_id=r.store_id
           WHERE l.product_id=sp.product_id AND pu.supplier_id=sp.supplier_id AND l.store_id=sp.store_id
           ORDER BY r.created_at DESC LIMIT 1
         ) h ON true
         WHERE sp.store_id=$1 AND sp.active AND sp.pack_cost>0
         ORDER BY abs((h.unit_cost-(sp.pack_cost/sp.pack_size))/NULLIF(sp.pack_cost/sp.pack_size,0)) DESC
         LIMIT 20`,
        [store.id],
      )
    ).rows.map((r) => ({ ...r, percent: Number(r.percent) }));
  }

  /** Twelve months of margin, used for the trend chart on the month view. */
  private async marginTrend(store: Store, today: string) {
    const rows = (
      await this.database.pool.query(
        `WITH ${financialEntries}, months AS (
 SELECT to_char(generate_series(date_trunc('month',$2::date)-interval '11 months',date_trunc('month',$2::date),interval '1 month'),'YYYY-MM') AS month
), sold AS (
 SELECT to_char(created_at AT TIME ZONE $3,'YYYY-MM') AS month,
 sum(revenue) AS revenue,sum(cost) AS cost,sum(missing) AS missing
 FROM financial_entries
 WHERE created_at>=((date_trunc('month',$2::date)-interval '11 months') AT TIME ZONE $3)
 GROUP BY 1
)
SELECT m.month,COALESCE(sold.revenue,0)::text AS revenue,
 CASE WHEN sold.missing=0 THEN sold.cost::text END AS cost,
 CASE WHEN sold.missing=0 AND sold.revenue>0
  THEN round((sold.revenue-sold.cost)*100/sold.revenue,2)::float END AS margin
 FROM months m LEFT JOIN sold ON sold.month=m.month ORDER BY m.month`,
        [store.id, today, store.timezone],
      )
    ).rows;
    return rows;
  }

  /** How much sales history exists, so premature conclusions can be suppressed. */
  private async history(store: Store) {
    const row = (
      await this.database.pool.query(
        `SELECT min(created_at) AS first,count(*)::text AS sales FROM sales WHERE store_id=$1`,
        [store.id],
      )
    ).rows[0];
    if (!row.first) return { days: 0, sales: 0, firstSale: null };
    const days = Math.floor((Date.now() - new Date(row.first).getTime()) / 86400000) + 1;
    return { days, sales: num(row.sales), firstSale: row.first };
  }

  /** Persist one row per store and detector key; observations never overwrite manager decisions. */
  private async syncInsights(store: Store, detected: Insight[]) {
    await this.database.pool.query(
      `INSERT INTO manager_insight_states(store_id,insight_id,snapshot)
       SELECT $1,x.id,x.snapshot FROM jsonb_to_recordset($2::jsonb) AS x(id text,snapshot jsonb)
       ON CONFLICT(store_id,insight_id) DO UPDATE SET
         snapshot=EXCLUDED.snapshot,last_detected_at=now(),condition_active=true,
         status=CASE WHEN manager_insight_states.condition_active THEN manager_insight_states.status ELSE 'NEW' END,
         first_detected_at=CASE WHEN manager_insight_states.condition_active THEN manager_insight_states.first_detected_at ELSE now() END,
         updated_by=CASE WHEN manager_insight_states.condition_active THEN manager_insight_states.updated_by ELSE NULL END,
         snoozed_until=CASE WHEN manager_insight_states.condition_active THEN manager_insight_states.snoozed_until ELSE NULL END`,
      [
        store.id,
        JSON.stringify(detected.map((insight) => ({ id: insight.id, snapshot: insight }))),
      ],
    );
    const ids = detected.map((insight) => insight.id);
    await this.database.pool.query(
      `UPDATE manager_insight_states SET condition_active=false,
         status=CASE WHEN status IN ('NEW','SEEN','IN_PROGRESS','SNOOZED') THEN 'RESOLVED' ELSE status END,
         snoozed_until=NULL,updated_at=now(),updated_by=NULL
       WHERE store_id=$1 AND condition_active AND NOT (insight_id=ANY($2::text[]))`,
      [store.id, ids],
    );
    await this.database.pool.query(
      `UPDATE manager_insight_states SET status='NEW',snoozed_until=NULL,updated_at=now()
       WHERE store_id=$1 AND status='SNOOZED' AND snoozed_until<=now()`,
      [store.id],
    );
    return this.decorateInsights(store, detected);
  }

  private async decorateInsights(store: Store, detected: Insight[]) {
    const states = (
      await this.database.pool.query(
        `SELECT insight_id,status,snoozed_until,first_detected_at FROM manager_insight_states WHERE store_id=$1`,
        [store.id],
      )
    ).rows;
    const byId = new Map(states.map((row: any) => [row.insight_id, row]));
    return detected
      .map((insight) => {
        const row: any = byId.get(insight.id);
        return {
          ...insight,
          status: row?.status ?? 'NEW',
          group: insightGroup(insight),
          firstDetectedAt: row?.first_detected_at,
          snoozedUntil: row?.snoozed_until,
        };
      })
      .sort((a, b) => insightPriority(b) - insightPriority(a));
  }

  @Get('action-center') @Require('analytics.view') async actionCenter(@Req() req: AuthRequest) {
    await this.dashboard({ period: 'today' }, req);
    const rows = (
      await this.database.pool.query(
        `SELECT insight_id,status,snapshot,snoozed_until,first_detected_at,last_detected_at,updated_at
       FROM manager_insight_states WHERE store_id=$1 ORDER BY last_detected_at DESC`,
        [req.context.store.id],
      )
    ).rows;
    const now = Date.now();
    const canMargin = req.context.user.permissions.includes('analytics.margin');
    return {
      currency: req.context.store.currency,
      thresholdDays: (
        await this.database.pool.query('SELECT no_sales_threshold_days FROM stores WHERE id=$1', [
          req.context.store.id,
        ])
      ).rows[0].no_sales_threshold_days,
      insights: rows
        .filter(
          (row: any) =>
            canMargin ||
            (row.snapshot.type !== 'margin' &&
              row.snapshot.id !== 'dead-stock' &&
              row.snapshot.id !== 'missing-cost'),
        )
        .map((row: any) => ({
          ...row.snapshot,
          id: row.insight_id,
          status: row.status,
          group: insightGroup(row.snapshot),
          firstDetectedAt: row.first_detected_at,
          lastDetectedAt: row.last_detected_at,
          updatedAt: row.updated_at,
          snoozedUntil: row.snoozed_until,
          active:
            row.status !== 'RESOLVED' &&
            row.status !== 'DISMISSED' &&
            !(
              row.status === 'SNOOZED' &&
              row.snoozed_until &&
              new Date(row.snoozed_until).getTime() > now
            ),
        }))
        .sort((a: any, b: any) => insightPriority(b) - insightPriority(a)),
    };
  }

  @Post('action-center/:id/state') @Require('analytics.view') async insightState(
    @Param('id') id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const body = parse(
      z.object({
        status: z.enum(['SEEN', 'IN_PROGRESS', 'SNOOZED', 'RESOLVED', 'DISMISSED']),
        snoozedUntil: z.string().datetime().optional(),
      }),
      input,
    );
    if (
      body.status === 'SNOOZED' &&
      (!body.snoozedUntil || new Date(body.snoozedUntil).getTime() <= Date.now())
    )
      throw new BadRequestException('Choose a future snooze time.');
    const row = (
      await this.database.pool.query(
        `UPDATE manager_insight_states SET status=$3,snoozed_until=$4,updated_at=now(),updated_by=$5
       WHERE store_id=$1 AND insight_id=$2 RETURNING insight_id,status`,
        [
          req.context.store.id,
          id,
          body.status,
          body.status === 'SNOOZED' ? body.snoozedUntil : null,
          req.context.user.id,
        ],
      )
    ).rows[0];
    if (!row) throw new NotFoundException('Insight not found.');
    return row;
  }

  @Get('action-center/no-sales') @Require('analytics.view') async noSales(
    @Query() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(z.object({ days: z.coerce.number().int().min(7).max(365).optional() }), input);
    const store = req.context.store as Store;
    const defaultThreshold = (
      await this.database.pool.query('SELECT no_sales_threshold_days FROM stores WHERE id=$1', [
        store.id,
      ])
    ).rows[0].no_sales_threshold_days;
    const threshold = b.days ?? defaultThreshold;
    const canCost = req.context.user.permissions.includes('analytics.margin');
    const today = storeToday(new Date(), store.timezone);
    const rows = (
      await this.database.pool.query(
        `WITH last_sale AS (
        SELECT COALESCE(p.base_product_id,i.product_id) AS product_id,max(s.created_at) AS sold_at
        FROM sale_items i JOIN sales s ON s.id=i.sale_id AND s.store_id=$1
        JOIN products p ON p.id=i.product_id AND p.store_id=i.store_id
        WHERE i.store_id=$1 GROUP BY 1
      ), batches AS (
        SELECT COALESCE(p.base_product_id,b.product_id) AS product_id,sum(b.quantity) AS quantity,sum(round(b.quantity*b.unit_cost,2)) AS value,
          bool_or(cost_source='legacy_estimate') AS estimated,bool_or(unit_cost=0) AS missing
        FROM stock_batches b JOIN products p ON p.id=b.product_id AND p.store_id=b.store_id
        WHERE b.store_id=$1 AND b.quantity>0 GROUP BY 1
      )
      SELECT p.id,p.name,p.sku,p.category,b.quantity::text AS quantity,p.price::text AS "sellingPrice",
        l.sold_at AS "lastSaleAt",p.created_at AS "createdAt",b.value::text AS "inventoryValue",round(b.value/nullif(b.quantity,0),2)::text AS "unitCost",
        b.estimated AS "costEstimated",b.missing AS "costMissing",
        floor(extract(epoch FROM ($3::date::timestamp AT TIME ZONE $4)-COALESCE(l.sold_at,p.created_at))/86400)::int AS "daysWithoutSale",
    COALESCE(sp.suppliers,'') AS suppliers
      FROM products p JOIN batches b ON b.product_id=p.id LEFT JOIN last_sale l ON l.product_id=p.id
      LEFT JOIN LATERAL (
        SELECT string_agg(DISTINCT s.name,', ' ORDER BY s.name) AS suppliers
        FROM supplier_products link JOIN suppliers s ON s.id=link.supplier_id AND s.store_id=link.store_id
        WHERE link.store_id=$1 AND link.product_id=p.id AND link.active
      ) sp ON true
      WHERE p.store_id=$1 AND p.base_product_id IS NULL AND p.active AND b.quantity>0
        AND COALESCE(l.sold_at,p.created_at)<(($3::date::timestamp AT TIME ZONE $4)-($2||' days')::interval)
      ORDER BY "daysWithoutSale" DESC,p.name`,
        [store.id, threshold, today, store.timezone],
      )
    ).rows;
    return {
      thresholdDays: threshold,
      defaultThresholdDays: defaultThreshold,
      today,
      timezone: store.timezone,
      currency: store.currency,
      rows: rows.map((row: any) =>
        canCost
          ? row
          : {
              ...row,
              inventoryValue: null,
              unitCost: null,
              costEstimated: null,
              costMissing: null,
            },
      ),
    };
  }

  /** Assembles the measured facts the deterministic rules run against. */
  private facts(store: Store, data: any): InsightFacts {
    const { current, previous, history, products, inventory, waste, purchasing } = data;
    const outOfStock = products.byRevenue
      .filter((p: any) => num(p.stock) <= 0)
      .concat(products.runningOut.filter((p: any) => num(p.stock) <= 0));
    const seen = new Set<string>();
    const uniqueOut = outOfStock.filter((p: any) =>
      seen.has(p.id) ? false : (seen.add(p.id), true),
    );
    return {
      currency: store.currency,
      historyDays: history.days,
      revenue: String(current.revenue),
      previousRevenue: previous ? String(previous.revenue) : null,
      grossMargin: current.grossMargin,
      previousGrossMargin: previous?.grossMargin ?? null,
      outOfStock: uniqueOut.map((p: any) => ({
        id: p.id,
        label: p.name,
        weeklyUnits: p.weeklyUnits,
        weeklyRevenue: p.weeklyRevenue,
      })),
      lowStock: products.runningOut
        .filter((p: any) => num(p.stock) > 0)
        .map((p: any) => ({
          id: p.id,
          label: p.name,
          stock: p.stock,
          minStock: p.minStock,
        })),
      runningOut: products.runningOut
        .filter((p: any) => p.daysOfStock !== null && num(p.stock) > 0)
        .map((p: any) => ({ id: p.id, label: p.name, days: p.daysOfStock })),
      deadStock: inventory
        ? {
            count: inventory.dead.count,
            units: inventory.dead.units,
            missingCostProducts: inventory.dead.missingCostProducts,
            value: inventory.dead.value,
            days: inventory.dead.days,
            estimated: inventory.dead.estimated,
          }
        : { count: 0, value: '0', days: data.deadDays },
      costIncreases: (inventory ? purchasing.costIncreases : []).map((p: any) => ({
        id: p.id,
        label: p.label,
        previousCost: p.previousCost,
        currentCost: p.currentCost,
        percent: p.percent,
        priceUnchanged: p.priceUnchanged,
        weeklyUnits: p.weeklyUnits,
      })),
      negativeMargin: products.lowMargin
        .filter((p: any) => p.unitMargin !== null && p.unitMargin < 0)
        .map((p: any) => ({ id: p.id, label: p.name, margin: p.unitMargin })),
      refundRate: data.refunds.rate,
      baselineRefundRate:
        previous && previous.revenue > 0 ? ratio(previous.refunds, previous.revenue) : null,
      refundOutliers: data.refunds.outliers.map((r: any) => ({
        id: r.id,
        label: r.label,
        rate: r.rate,
        baseline: data.refunds.rate ?? 0,
        kind: 'register',
      })),
      discountValue: String(data.discounts.value),
      baselineDiscountValue:
        data.discounts.previous === null ? null : String(data.discounts.previous),
      wasteValue: String(waste.value),
      baselineWasteValue: waste.previous === null ? null : String(waste.previous),
      cashDifferences: data.shifts.differences.map((s: any) => ({
        id: s.id,
        label: `${s.register} · ${s.cashier}`,
        difference: s.difference,
      })),
      shiftHours: data.shiftHours,
      longOpenShifts: data.shifts.longOpen.map((s: any) => ({
        id: s.id,
        label: `${s.register} · ${s.cashier}`,
        hours: num(s.hours),
      })),
      missingCost: data.readiness.missingCost,
      uncountedProducts: data.readiness.uncounted,
      staleQuotes: inventory ? data.staleQuotes : [],
    };
  }
}

/** Internal ranking: operational urgency, money at risk, evidence volume and age. */
function insightPriority(insight: Insight & { firstDetectedAt?: Date | string }) {
  const severity =
    { critical: 4000, important: 3000, attention: 2000, info: 1000 }[insight.severity] ?? 0;
  const operational =
    insight.type === 'shifts' || insight.type === 'refunds'
      ? 180
      : insight.type === 'inventory'
        ? 120
        : insight.type === 'data'
          ? -80
          : 0;
  const amount = Number(insight.impact?.amount ?? 0);
  const financial =
    Number.isFinite(amount) && amount > 0
      ? Math.min(250, Math.log10(amount + 1) * 45) * (insight.impact?.estimate ? 0.65 : 1)
      : 0;
  const volume = Math.min(100, (insight.entities?.length ?? 0) * 12);
  const age = insight.firstDetectedAt
    ? Math.min(
        60,
        Math.max(0, (Date.now() - new Date(insight.firstDetectedAt).getTime()) / 86400000) * 2,
      )
    : 0;
  return severity + operational + financial + volume + age;
}

function insightGroup(insight: Insight): string {
  if (insight.type === 'data') return 'Setup';
  if (insight.id === 'dead-stock') return 'Opportunities';
  if (
    insight.severity === 'critical' ||
    insight.id === 'negative-margin' ||
    insight.id === 'cash-difference'
  )
    return 'Action now';
  if (
    insight.type === 'inventory' ||
    insight.type === 'shifts' ||
    insight.id === 'margin-protection'
  )
    return 'Today';
  return 'Review';
}

/** Averages a multi-period baseline down to a single comparable period. */
function scaleTotals(totals: any, divisor: number) {
  const scale = (value: number | null) => (value === null ? null : value / divisor);
  const revenue = scale(totals.revenue)!;
  const profit = scale(totals.grossProfit);
  return {
    ...totals,
    transactions: totals.transactions / divisor,
    revenue,
    discount: scale(totals.discount),
    refunds: scale(totals.refunds),
    units: scale(totals.units),
    cogs: scale(totals.cogs),
    grossProfit: profit,
    operatingExpenses: scale(totals.operatingExpenses),
    paidPurchases: scale(totals.paidPurchases),
    totalSpending: scale(totals.totalSpending),
    netProfit: scale(totals.netProfit),
    // Ratios are unaffected by scaling, so they are recomputed rather than divided.
    grossMargin: grossMargin(profit, revenue),
    averageBasket: averageBasket(revenue, totals.transactions / divisor),
  };
}

@Module({ imports: [AuthModule, FinancialMetricsModule], controllers: [OwnerDashboardController] })
export class OwnerDashboardModule {}
