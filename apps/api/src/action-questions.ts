import { Injectable } from '@nestjs/common';
import {
  actionQuestionRanges,
  storeToday,
  toScaled,
  type ActionQuestionPeriod,
  type ActionQuestionReport,
} from '@eliza/contracts';
import type { AuthRequest } from './security.js';
import { Database } from './database.js';
import { ReplenishmentService, replenishmentPermissions } from './replenishment.js';
import { FinancialMetricsService } from './financial-metrics.js';

type Candidate = { id: string; name: string; volume?: string; unit: string; units: string };
@Injectable()
export class ActionQuestionsService {
  constructor(
    private readonly database: Database,
    private readonly replenishment: ReplenishmentService,
    private readonly finances: FinancialMetricsService,
  ) {}

  async report(
    req: AuthRequest,
    period: ActionQuestionPeriod,
    candidates: Candidate[],
    missingProfit = 0,
  ): Promise<ActionQuestionReport> {
    const { store, user } = req.context;
    const now = new Date();
    const today = storeToday(now, store.timezone);
    const { current, previous } = actionQuestionRanges(period, today);
    const canPlan = replenishmentPermissions.every((p) => user.permissions.includes(p));
    const canInventory = user.permissions.includes('inventory.read');
    const canSales = user.permissions.includes('sales.read');
    const canCosts =
      user.permissions.includes('analytics.margin') && user.permissions.includes('costs.read');
    const canPurchases =
      canCosts &&
      user.permissions.includes('purchases.read') &&
      user.permissions.includes('suppliers.read');
    const clock =
      period === 'today'
        ? new Intl.DateTimeFormat('en-GB', {
            timeZone: store.timezone,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
          }).format(now)
        : null;
    const [planning, expiry, costs, demand, assortment] = await Promise.all([
      canPlan ? this.replenishment.report(req, { historyDays: 28 }, true) : null,
      canInventory
        ? this.expiry(store.id, today, user.permissions.includes('suppliers.read'))
        : null,
      canPurchases ? this.costs(store.id) : null,
      canSales ? this.demand(store.id, store.timezone, current, previous, clock) : null,
      canCosts && canSales ? this.assortment(store.id, store.timezone, current, candidates) : null,
    ]);
    const orderRows =
      planning?.rows.filter((p) => p.status === 'order_now' || p.status === 'order_later') ?? [];
    orderRows.sort(
      (a, b) =>
        (a.status === 'order_now' ? 0 : 1) - (b.status === 'order_now' ? 0 : 1) ||
        (a.orderBy ?? '9999').localeCompare(b.orderBy ?? '9999') ||
        a.name.localeCompare(b.name),
    );
    const overstock =
      planning?.rows.filter(
        (p) =>
          Number(p.available) > 0 && (p.demandStatus === 'no_sales' || p.demandStatus === 'slow'),
      ) ?? [];
    const priority = (p: (typeof overstock)[number]) =>
      p.demandStatus === 'no_sales' ? Infinity : (p.daysOfStock ?? 0);
    overstock.sort((a, b) => priority(b) - priority(a) || a.name.localeCompare(b.name));
    return {
      today,
      timezone: store.timezone,
      currency: store.currency,
      generatedAt: now.toISOString(),
      period,
      range: current,
      comparison: previous,
      planning: {
        allowed: canPlan,
        total: orderRows.length,
        orderNow: orderRows.filter((p) => p.status === 'order_now').length,
        needsReview: planning?.rows.filter((p) => p.status === 'needs_review').length ?? 0,
        insufficientHistory:
          planning?.rows.filter((p) => p.status === 'insufficient_history').length ?? 0,
        truncated: planning?.truncated ?? false,
        rows: orderRows.slice(0, 4),
      },
      expiry: {
        allowed: canInventory,
        total: expiry?.total ?? 0,
        unknownProducts: expiry?.unknownProducts ?? 0,
        rows: expiry?.rows ?? [],
      },
      overstock: {
        allowed: canPlan,
        total: overstock.length,
        truncated: planning?.truncated ?? false,
        rows: overstock.slice(0, 4),
      },
      costs: { allowed: canPurchases, total: costs?.total ?? 0, rows: costs?.rows ?? [] },
      demand: {
        allowed: canSales,
        receipts: demand?.receipts ?? 0,
        previousReceipts: demand?.previousReceipts ?? 0,
        rows: demand?.rows ?? [],
      },
      assortment: {
        allowed: canCosts && canSales,
        incomplete: (assortment?.incomplete ?? 0) + (canCosts && canSales ? missingProfit : 0),
        rows: assortment?.rows ?? [],
      },
    };
  }

  private async expiry(store: string, today: string, suppliers: boolean) {
    const result = await this.database.pool.query(
      `WITH due AS (
      SELECT b.id,p.id AS "productId",p.name,p.volume,p.unit,b.quantity::text,
        b.expiry_date::text AS "expiryDate",b.expiry_date<=$2::date AS expired,
        CASE WHEN $3::boolean THEN s.name END AS "supplierName"
      FROM stock_batches b JOIN products p ON p.id=b.product_id AND p.store_id=b.store_id
      LEFT JOIN goods_receipt_lines l ON l.id=b.receipt_line_id AND l.store_id=b.store_id
      LEFT JOIN goods_receipts g ON g.id=l.receipt_id AND g.store_id=l.store_id
      LEFT JOIN purchases o ON o.id=g.purchase_id AND o.store_id=g.store_id
      LEFT JOIN suppliers s ON s.id=o.supplier_id AND s.store_id=o.store_id
      WHERE b.store_id=$1 AND p.active AND b.quantity>0 AND b.expiry_date<=$2::date+7
    ) SELECT (SELECT count(*)::int FROM due) AS total,
      (SELECT count(DISTINCT b.product_id)::int FROM stock_batches b JOIN products p ON p.id=b.product_id AND p.store_id=b.store_id
       WHERE b.store_id=$1 AND p.active AND b.quantity>0 AND b.expiry_date IS NULL) AS unknown,
      COALESCE((SELECT jsonb_agg(x) FROM (SELECT * FROM due ORDER BY "expiryDate",name,id LIMIT 4)x),'[]'::jsonb) AS rows`,
      [store, today, suppliers],
    );
    return {
      total: result.rows[0].total,
      unknownProducts: result.rows[0].unknown,
      rows: result.rows[0].rows,
    };
  }

  private async costs(store: string) {
    const result = await this.database.pool.query(
      `WITH received AS (
      SELECT l.product_id,o.supplier_id,g.id,g.created_at,
        sum(l.quantity*l.unit_cost)/NULLIF(sum(l.quantity),0) AS cost
      FROM goods_receipt_lines l JOIN goods_receipts g ON g.id=l.receipt_id AND g.store_id=l.store_id
      JOIN purchases o ON o.id=g.purchase_id AND o.store_id=g.store_id
      WHERE l.store_id=$1 AND l.quantity>0 AND l.unit_cost IS NOT NULL
      GROUP BY l.product_id,o.supplier_id,g.id,g.created_at
    ), ranked AS (
      SELECT *,row_number() OVER(PARTITION BY product_id,supplier_id ORDER BY created_at DESC,id DESC) AS rank,
        lead(cost) OVER(PARTITION BY product_id,supplier_id ORDER BY created_at DESC,id DESC) AS previous
      FROM received
    ), recent AS (SELECT * FROM ranked WHERE rank=1), items AS (
      SELECT p.id AS "productId",p.name,p.volume,p.unit,s.name AS "supplierName",r.created_at AS "paidAt",
        round(r.cost,4)::text AS cost,round(r.previous,4)::text AS "previousCost",
        CASE WHEN r.previous>0 THEN round((r.cost-r.previous)*100/r.previous,2)::text END AS change,
        other.name AS "alternativeSupplier",round(other.cost,4)::text AS "alternativeCost",other.created_at AS "alternativeDate"
      FROM recent r JOIN products p ON p.id=r.product_id AND p.store_id=$1
      JOIN suppliers s ON s.id=r.supplier_id AND s.store_id=$1
      LEFT JOIN LATERAL (
        SELECT s2.name,x.cost,x.created_at FROM recent x JOIN suppliers s2 ON s2.id=x.supplier_id AND s2.store_id=$1
        WHERE x.product_id=r.product_id AND x.supplier_id<>r.supplier_id AND s2.active AND x.cost<r.cost
        ORDER BY x.cost,x.created_at DESC,x.supplier_id LIMIT 1
      ) other ON true WHERE p.active
    ) SELECT (SELECT count(*)::int FROM items) AS total,
      COALESCE((SELECT jsonb_agg(x) FROM (SELECT * FROM items ORDER BY change::numeric DESC NULLS LAST,"paidAt" DESC,"productId","supplierName" LIMIT 4)x),'[]'::jsonb) AS rows`,
      [store],
    );
    return result.rows[0] as ActionQuestionReport['costs'];
  }

  private async demand(
    store: string,
    timezone: string,
    current: { from: string; to: string },
    previous: { from: string; to: string },
    clock: string | null,
  ) {
    const result = await this.database.pool.query(
      `WITH windows AS (
      SELECT 'current' AS phase,($2::date::timestamp AT TIME ZONE $6) AS start_at,
        (CASE WHEN $7::text IS NULL THEN ($3::date+1)::timestamp ELSE $3::date+$7::time END AT TIME ZONE $6) AS end_at
      UNION ALL SELECT 'previous',($4::date::timestamp AT TIME ZONE $6),
        (CASE WHEN $7::text IS NULL THEN ($5::date+1)::timestamp ELSE $5::date+$7::time END AT TIME ZONE $6)
    ), matched AS (
      SELECT w.phase,s.id FROM windows w JOIN sales s ON s.store_id=$1 AND s.created_at>=w.start_at AND s.created_at<w.end_at
    ), quantities AS (
      SELECT COALESCE(p.base_product_id,p.id) AS product_id,
        COALESCE(sum(i.quantity) FILTER(WHERE m.phase='current'),0) AS quantity,
        COALESCE(sum(i.quantity) FILTER(WHERE m.phase='previous'),0) AS previous
      FROM matched m JOIN sale_items i ON i.sale_id=m.id AND i.store_id=$1
      JOIN products p ON p.id=i.product_id AND p.store_id=i.store_id GROUP BY 1
    ), changed AS (
      SELECT p.id AS "productId",p.name,p.volume,p.unit,q.quantity::text AS quantity,
        q.previous::text AS "previousQuantity",(q.quantity-q.previous)::text AS change
      FROM quantities q JOIN products p ON p.id=q.product_id AND p.store_id=$1 WHERE q.quantity<>q.previous
    ), leaders AS (
      (SELECT * FROM changed WHERE change::numeric>0 ORDER BY change::numeric DESC,"productId" LIMIT 3)
      UNION ALL (SELECT * FROM changed WHERE change::numeric<0 ORDER BY change::numeric,"productId" LIMIT 3)
    ) SELECT (SELECT count(*)::int FROM matched WHERE phase='current') AS receipts,
      (SELECT count(*)::int FROM matched WHERE phase='previous') AS "previousReceipts",
      COALESCE((SELECT jsonb_agg(leaders) FROM leaders),'[]'::jsonb) AS rows`,
      [store, current.from, current.to, previous.from, previous.to, timezone, clock],
    );
    return result.rows[0] as ActionQuestionReport['demand'];
  }

  private async assortment(
    store: string,
    timezone: string,
    range: { from: string; to: string },
    candidates: Candidate[],
  ) {
    const values = await Promise.all(
      candidates.slice(0, 10).map(async (p) => {
        const summary = await this.finances.getFinancialSummary(
          store,
          { ...range, timezone },
          { productId: p.id },
        );
        return { ...p, summary };
      }),
    );
    const rows = values
      .filter((p) => p.summary.grossProfit !== null)
      .map((p) => ({
        productId: p.id,
        name: p.name,
        volume: p.volume,
        unit: p.unit,
        quantity: p.units,
        grossProfit: p.summary.grossProfit!,
        revenue: p.summary.revenue,
      }))
      .sort((a, b) =>
        toScaled(a.grossProfit, 2) > toScaled(b.grossProfit, 2)
          ? -1
          : toScaled(a.grossProfit, 2) < toScaled(b.grossProfit, 2)
            ? 1
            : a.name.localeCompare(b.name),
      );
    return {
      incomplete: values.filter((p) => p.summary.grossProfit === null).length,
      rows: rows.slice(0, 4),
    };
  }
}
