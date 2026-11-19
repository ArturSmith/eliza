import type { Pool } from 'pg';
/** Shop-scoped platform membership and ledger data only; no customer PII lookup. */
export async function loyaltyMembers(
  pool: Pool,
  store: string,
  timezone: string,
  period: { from: string; to: string; page: number },
) {
  const pageSize = 50;
  const result = (
    await pool.query(
      `WITH bounds AS (
    SELECT ($2::date::timestamp AT TIME ZONE $4) AS start_at,(($3::date+1)::timestamp AT TIME ZONE $4) AS end_at
  ), wallets AS (
    SELECT e.membership_id,sum(e.amount) AS balance,
      COALESCE(sum(e.amount) FILTER(WHERE e.created_at<b.end_at),0) AS balance_at_end,
      -COALESCE(sum(e.amount) FILTER(WHERE e.kind='redeemed' AND e.created_at>=b.start_at AND e.created_at<b.end_at),0) AS used,
      COALESCE(sum(e.amount) FILTER(WHERE e.kind='refund_redeemed' AND e.created_at>=b.start_at AND e.created_at<b.end_at),0) AS restored
    FROM loyalty_entries e CROSS JOIN bounds b WHERE e.store_id=$1 GROUP BY e.membership_id
  ), members AS (
    SELECT m.id,m.created_at,COALESCE(w.balance,0) AS balance,
      COALESCE(w.balance_at_end,0) AS balance_at_end,COALESCE(w.used,0) AS used,COALESCE(w.restored,0) AS restored
    FROM loyalty_memberships m LEFT JOIN wallets w ON w.membership_id=m.id WHERE m.store_id=$1
  ), page AS (
    SELECT id,created_at AS "joinedAt",balance::numeric(30,2)::text AS "currentBalance",
      balance_at_end::numeric(30,2)::text AS "periodEndBalance",used::numeric(30,2)::text AS used,
      restored::numeric(30,2)::text AS restored,(used-restored)::numeric(30,2)::text AS spent
    FROM members ORDER BY created_at DESC,id DESC LIMIT $5 OFFSET $6
  ) SELECT (SELECT count(*)::int FROM members) AS total,
    COALESCE((SELECT json_agg(page ORDER BY page."joinedAt" DESC,page.id DESC) FROM page),'[]'::json) AS members,
    COALESCE(sum(balance),0)::numeric(30,2)::text AS "currentBalance",
    COALESCE(sum(balance_at_end),0)::numeric(30,2)::text AS "periodEndBalance",
    COALESCE(sum(used),0)::numeric(30,2)::text AS used,
    COALESCE(sum(restored),0)::numeric(30,2)::text AS restored,
    COALESCE(sum(used-restored),0)::numeric(30,2)::text AS spent,
    COALESCE(sum(GREATEST(balance,0)),0)::numeric(30,2)::text AS "availableBalance",
    COALESCE(sum(LEAST(balance,0)),0)::numeric(30,2)::text AS "negativeBalance"
    FROM members`,
      [store, period.from, period.to, timezone, pageSize, (period.page - 1) * pageSize],
    )
  ).rows[0];
  const { members, total, ...totals } = result;
  return {
    period: { from: period.from, to: period.to, timezone },
    total,
    page: period.page,
    pageSize,
    totals,
    members,
  };
}
