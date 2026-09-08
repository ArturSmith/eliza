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
const filter = z
  .object({
    from: date,
    to: date,
    group: z
      .enum([
        'day',
        'week',
        'month',
        'shift',
        'cashier',
        'register',
        'product',
        'category',
        'payment',
      ])
      .default('day'),
  })
  .refine((v) => v.from <= v.to, 'Start date must not be after end date')
  .refine(
    (v) => (Date.parse(v.to) - Date.parse(v.from)) / 86400000 <= 3660,
    'Choose a range of ten years or less',
  );
@Controller('reports')
@UseGuards(AccessGuard)
export class SalesSummaryController {
  constructor(private database: Database) {}
  @Get('sales-summary') @Require('sales.read') async summary(
    @Query() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const b = parse(filter, input);
    // Boundaries are local calendar midnights, including DST changes. Aggregate payments
    // per sale first so multiple payment rows cannot multiply sale totals.
    const result = await this.database.pool.query(
      `WITH selected AS (
 SELECT s.*,h.opened_at,COALESCE(s.receipt->>'cashierName','Unknown cashier') AS cashier,
 COALESCE(s.receipt->>'deviceName','Unknown register') AS register,
 COALESCE(p.cash,0) AS cash,COALESCE(p.card,0) AS card
 FROM sales s JOIN shifts h ON h.id=s.shift_id AND h.store_id=s.store_id
 LEFT JOIN LATERAL (SELECT sum(amount) FILTER(WHERE method='cash') AS cash,sum(amount) FILTER(WHERE method='card') AS card FROM payments WHERE sale_id=s.id AND store_id=s.store_id) p ON true
 WHERE s.store_id=$1 AND s.created_at>=($2::date::timestamp AT TIME ZONE $4)
 AND s.created_at< (($3::date+1)::timestamp AT TIME ZONE $4)
 ), entries AS (
 SELECT s.id,
 CASE $5 WHEN 'shift' THEN shift_id::text WHEN 'cashier' THEN employee_id::text WHEN 'register' THEN device_id::text
 WHEN 'week' THEN to_char(date_trunc('week',created_at AT TIME ZONE $4),'YYYY-MM-DD')
 ELSE to_char(created_at AT TIME ZONE $4,CASE WHEN $5='month' THEN 'YYYY-MM' ELSE 'YYYY-MM-DD' END) END AS bucket,
 CASE $5 WHEN 'cashier' THEN cashier WHEN 'register' THEN register END AS label,
 total,tax,discount,cash,card,cashier,register,opened_at,NULL::numeric AS quantity,NULL::text AS unit
 FROM selected s WHERE $5 NOT IN ('product','category','payment')
 UNION ALL
 SELECT s.id,CASE WHEN $5='product' THEN l->>'productId' ELSE COALESCE(l->>'category','Unrecorded category') END,
 CASE WHEN $5='product' THEN (l->>'name')||' · '||(l->>'sku') ELSE COALESCE(l->>'category','Unrecorded category') END,
 (l->>'total')::numeric,(l->>'tax')::numeric,(l->>'discount')::numeric,NULL,NULL,s.cashier,s.register,s.opened_at,
 CASE WHEN $5='product' THEN (l->>'quantity')::numeric END,CASE WHEN $5='product' THEN l->>'unit' END
 FROM selected s CROSS JOIN LATERAL jsonb_array_elements(s.receipt->'lines') l WHERE $5 IN ('product','category')
 UNION ALL
 SELECT s.id,p.method,p.method,p.amount,NULL,NULL,
 CASE WHEN p.method='cash' THEN p.amount ELSE 0 END,CASE WHEN p.method='card' THEN p.amount ELSE 0 END,
 s.cashier,s.register,s.opened_at,NULL,NULL
 FROM selected s JOIN payments p ON p.sale_id=s.id AND p.store_id=s.store_id WHERE $5='payment'
 ), grouped AS (
 SELECT bucket,0 AS overall,min(label) AS label,count(DISTINCT id)::text AS transactions,
 sum(total)::text AS total,sum(tax)::text AS tax,sum(discount)::text AS discount,sum(cash)::text AS cash,sum(card)::text AS card,
 round(sum(total)/count(DISTINCT id),2)::text AS average,
 CASE WHEN $5='shift' THEN min(cashier) END AS cashier,CASE WHEN $5='shift' THEN min(register) END AS register,
 CASE WHEN $5='shift' THEN min(opened_at) END AS "openedAt",sum(quantity)::text AS quantity,min(unit) AS unit
 FROM entries GROUP BY bucket
 UNION ALL
 SELECT NULL,1,NULL,count(*)::text,COALESCE(sum(total),0)::text,COALESCE(sum(tax),0)::text,
 COALESCE(sum(discount),0)::text,COALESCE(sum(cash),0)::text,COALESCE(sum(card),0)::text,
 COALESCE(round(avg(total),2),0)::text,NULL,NULL,NULL,NULL,NULL FROM selected
 ) SELECT grouped.*,
 (SELECT COALESCE(sum(total),0)::text FROM refunds WHERE store_id=$1 AND created_at>=($2::date::timestamp AT TIME ZONE $4) AND created_at<(($3::date+1)::timestamp AT TIME ZONE $4)) AS refunds,
 (CASE WHEN overall=1 THEN grouped.total::numeric-(SELECT COALESCE(sum(total),0) FROM refunds WHERE store_id=$1 AND created_at>=($2::date::timestamp AT TIME ZONE $4) AND created_at<(($3::date+1)::timestamp AT TIME ZONE $4)) END)::text AS net
 FROM grouped ORDER BY "openedAt" DESC NULLS LAST,bucket DESC NULLS LAST`,
      [req.context.store.id, b.from, b.to, req.context.store.timezone, b.group],
    );
    return {
      from: b.from,
      to: b.to,
      group: b.group,
      timezone: req.context.store.timezone,
      currency: req.context.store.currency,
      totals: result.rows.find((r) => r.overall === 1),
      rows: result.rows.filter((r) => r.overall === 0),
    };
  }
}
@Module({ imports: [AuthModule], controllers: [SalesSummaryController] })
export class SalesSummaryModule {}
