import { Controller, Get, Module, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthModule } from './auth.js';
import { AccessGuard, Require, parse, type AuthRequest } from './security.js';
import { Database } from './database.js';
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Enter a valid date',
  );
const id = z.union([z.uuid(), z.literal('')]).default('');
export const analyticsFilter = z
  .object({ from: date, to: date, productId: id, shiftId: id })
  .refine((v) => v.from <= v.to, 'Start date must not follow end date')
  .refine(
    (v) => Date.parse(v.to) - Date.parse(v.from) <= 3660 * 86400000,
    'Choose ten years or less',
  );
@Controller('reports')
@UseGuards(AccessGuard)
export class AnalyticsController {
  constructor(private database: Database) {}
  @Get('analytics') @Require('sales.read') async report(
    @Query() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(analyticsFilter, input);
    const args = [
      req.context.store.id,
      b.from,
      b.to,
      req.context.store.timezone,
      b.productId,
      b.shiftId,
    ];
    // Every dimension uses the same matched receipt lines. Product filters never
    // count the other items in a basket or invent a product/payment allocation.
    const result = await this.database.pool.query(
      `
WITH bounds AS (
 SELECT ($2::date::timestamp AT TIME ZONE $4) AS start,(($3::date+1)::timestamp AT TIME ZONE $4) AS finish
), matched AS (
 SELECT s.id,s.shift_id,s.employee_id,s.device_id,s.created_at,h.opened_at,
 s.receipt->>'cashierName' AS cashier,s.receipt->>'deviceName' AS register,
 l.lines,l.total,l.tax,l.discount,
 CASE WHEN $5='' THEN COALESCE(p.cash,0) END AS cash,
 CASE WHEN $5='' THEN COALESCE(p.card,0) END AS card
 FROM sales s JOIN shifts h ON h.id=s.shift_id AND h.store_id=s.store_id CROSS JOIN bounds b
 CROSS JOIN LATERAL (
  SELECT jsonb_agg(j) AS lines,sum((j->>'total')::numeric) AS total,
   sum((j->>'tax')::numeric) AS tax,sum((j->>'discount')::numeric) AS discount
  FROM jsonb_array_elements(s.receipt->'lines') j WHERE $5='' OR EXISTS (
   SELECT 1 FROM products pr WHERE pr.store_id=$1 AND pr.id=(j->>'productId')::uuid
   AND (pr.id::text=$5 OR pr.base_product_id::text=$5))
 ) l
 LEFT JOIN LATERAL (
  SELECT sum(amount) FILTER(WHERE method='cash') AS cash,sum(amount) FILTER(WHERE method='card') AS card
  FROM payments WHERE store_id=$1 AND sale_id=s.id
 ) p ON true
 WHERE s.store_id=$1 AND s.created_at>=b.start AND s.created_at<b.finish
 AND ($6='' OR s.shift_id::text=$6) AND l.lines IS NOT NULL
), entries AS (
 SELECT s.id,d.dimension,d.bucket,d.label,s.total,s.tax,s.discount,s.cash,s.card,
 NULL::numeric AS quantity,NULL::text AS unit,s.cashier,s.register,s.opened_at
 FROM matched s CROSS JOIN LATERAL (VALUES
 ('day',to_char(s.created_at AT TIME ZONE $4,'YYYY-MM-DD'),NULL::text),
 ('week',to_char(date_trunc('week',s.created_at AT TIME ZONE $4),'YYYY-MM-DD'),NULL),
 ('month',to_char(s.created_at AT TIME ZONE $4,'YYYY-MM'),NULL),
 ('year',to_char(s.created_at AT TIME ZONE $4,'YYYY'),NULL),
 ('hour',to_char(s.created_at AT TIME ZONE $4,'HH24'),NULL),
 ('weekday',extract(isodow from s.created_at AT TIME ZONE $4)::text,NULL),
 ('monthOfYear',to_char(s.created_at AT TIME ZONE $4,'MM'),NULL),
 ('dayOfMonth',to_char(s.created_at AT TIME ZONE $4,'DD'),NULL),
 ('shift',s.shift_id::text,s.cashier||' · '||s.register),
 ('cashier',s.employee_id::text,s.cashier),
 ('register',s.device_id::text,s.register)
 ) d(dimension,bucket,label)
 UNION ALL
 SELECT s.id,d.dimension,d.bucket,d.label,(j->>'total')::numeric,(j->>'tax')::numeric,
 (j->>'discount')::numeric,NULL,NULL,
 CASE WHEN d.dimension='product' THEN (j->>'quantity')::numeric END,
 CASE WHEN d.dimension='product' THEN j->>'unit' END,s.cashier,s.register,s.opened_at
 FROM matched s CROSS JOIN LATERAL jsonb_array_elements(s.lines) j
 LEFT JOIN products pr ON pr.id=(j->>'productId')::uuid AND pr.store_id=$1
 LEFT JOIN products bp ON bp.id=pr.base_product_id AND bp.store_id=$1
 CROSS JOIN LATERAL (VALUES
 ('product',COALESCE(pr.base_product_id::text,j->>'productId'),COALESCE(bp.name,j->>'name')||' · '||COALESCE(bp.sku,j->>'sku')),
 ('category',COALESCE(j->>'category','Unrecorded category'),COALESCE(j->>'category','Unrecorded category'))
 ) d(dimension,bucket,label)
 UNION ALL
 SELECT s.id,'payment',p.method,p.method,p.amount,NULL,NULL,
 CASE WHEN p.method='cash' THEN p.amount ELSE 0 END,CASE WHEN p.method='card' THEN p.amount ELSE 0 END,
 NULL,NULL,s.cashier,s.register,s.opened_at FROM matched s JOIN payments p ON p.sale_id=s.id AND p.store_id=$1 WHERE $5=''
), aggregates AS (
 SELECT dimension,bucket,min(label) AS label,count(DISTINCT id)::text AS transactions,sum(total)::text AS total,
 sum(tax)::text AS tax,sum(discount)::text AS discount,sum(cash)::text AS cash,sum(card)::text AS card,
 round(sum(total)/count(DISTINCT id),2)::text AS average,sum(quantity)::text AS quantity,min(unit) AS unit,
 CASE WHEN dimension='shift' THEN min(cashier) END AS cashier,
 CASE WHEN dimension='shift' THEN min(register) END AS register,
 CASE WHEN dimension='shift' THEN min(opened_at) END AS "openedAt"
 FROM entries GROUP BY dimension,bucket
), returns AS (
 SELECT COALESCE(sum(l.total),0) AS total
 FROM refunds r JOIN refund_lines l ON l.refund_id=r.id AND l.store_id=r.store_id
 JOIN sales s ON s.id=r.sale_id AND s.store_id=r.store_id CROSS JOIN bounds b
 WHERE r.store_id=$1 AND r.created_at>=b.start AND r.created_at<b.finish
 AND ($5='' OR l.product_id IN (SELECT id FROM products WHERE store_id=$1 AND (id::text=$5 OR base_product_id::text=$5))) AND ($6='' OR s.shift_id::text=$6)
)
SELECT
 (SELECT jsonb_build_object('transactions',count(*)::text,'total',COALESCE(sum(total),0)::text,
 'tax',COALESCE(sum(tax),0)::text,'discount',COALESCE(sum(discount),0)::text,
 'cash',CASE WHEN $5='' THEN COALESCE(sum(cash),0)::text END,
 'card',CASE WHEN $5='' THEN COALESCE(sum(card),0)::text END,
 'average',COALESCE(round(avg(total),2),0)::text,
 'refunds',(SELECT total::text FROM returns),
 'net',(COALESCE(sum(total),0)-(SELECT total FROM returns))::text) FROM matched) AS totals,
 (SELECT COALESCE(jsonb_agg(aggregates ORDER BY bucket),'[]') FROM aggregates) AS rows,
 (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'label',name||' · '||sku,'unit',unit,'active',active) ORDER BY name),'[]')
 FROM products WHERE store_id=$1 AND base_product_id IS NULL AND (created_at<(SELECT finish FROM bounds) OR id::text=$5)) AS products,
 (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',h.id,'cashier',e.name,'register',d.name,'openedAt',h.opened_at) ORDER BY h.opened_at DESC),'[]')
 FROM shifts h JOIN employees e ON e.id=h.employee_id AND e.store_id=h.store_id
 JOIN device_records d ON d.id=h.device_id AND d.store_id=h.store_id CROSS JOIN bounds b
 WHERE h.store_id=$1 AND ((h.opened_at<b.finish AND COALESCE(h.closed_at,now())>=b.start) OR h.id::text=$6)) AS shifts
`,
      args,
    );
    const data = result.rows[0];
    const groups: Record<string, any[]> = {};
    for (const row of data.rows) (groups[row.dimension] ??= []).push(row);
    const empty = (bucket: string, extra = {}) => ({
      bucket,
      label: null,
      transactions: '0',
      total: '0',
      tax: '0',
      discount: '0',
      cash: b.productId ? null : '0',
      card: b.productId ? null : '0',
      average: '0',
      quantity: '0',
      unit: null,
      ...extra,
    });
    function fill(group: string, candidates: any[]) {
      const existing = new Map((groups[group] ?? []).map((r) => [r.bucket, r]));
      for (const row of candidates) if (!existing.has(row.bucket)) existing.set(row.bucket, row);
      groups[group] = [...existing.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
    }
    const days = [];
    for (let time = Date.parse(b.from); time <= Date.parse(b.to); time += 86400000)
      days.push(new Date(time).toISOString().slice(0, 10));
    fill(
      'dayOfMonth',
      [...new Set(days.map((d) => d.slice(8, 10)))].map((d) => empty(d)),
    );
    fill(
      'day',
      days.map((d) => empty(d)),
    );
    fill(
      'month',
      [...new Set(days.map((d) => d.slice(0, 7)))].map((d) => empty(d)),
    );
    fill(
      'year',
      [...new Set(days.map((d) => d.slice(0, 4)))].map((d) => empty(d)),
    );
    fill(
      'hour',
      Array.from({ length: 24 }, (_, i) => empty(String(i).padStart(2, '0'))),
    );
    fill(
      'weekday',
      [...new Set(days.map((d) => String(new Date(d).getUTCDay() || 7)))].map((d) => empty(d)),
    );
    fill(
      'monthOfYear',
      [...new Set(days.map((d) => d.slice(5, 7)))].map((d) => empty(d)),
    );
    fill(
      'product',
      data.products
        .filter((p: any) => p.active && (!b.productId || p.id === b.productId))
        .map((p: any) => empty(p.id, { label: p.label, unit: p.unit, cash: null, card: null })),
    );
    fill(
      'shift',
      data.shifts
        .filter((s: any) => !b.shiftId || s.id === b.shiftId)
        .map((s: any) =>
          empty(s.id, {
            label: s.cashier + ' · ' + s.register,
            cashier: s.cashier,
            register: s.register,
            openedAt: s.openedAt,
          }),
        ),
    );
    return {
      ...b,
      currency: req.context.store.currency,
      timezone: req.context.store.timezone,
      totals: data.totals,
      groups,
      options: { products: data.products, shifts: data.shifts },
    };
  }
}
@Module({ imports: [AuthModule], controllers: [AnalyticsController] })
export class AnalyticsModule {}
