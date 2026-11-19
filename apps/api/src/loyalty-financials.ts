import type { PoolClient } from 'pg';
import type { FinancialPeriod } from './financial-metrics.js';
import { fromScaled, toScaled } from '@eliza/contracts';

/** Ledger events use their completion dates; wallet exposure is summed per customer. */
export async function loyaltyFinancials(
  client: PoolClient,
  storeId: string,
  period: FinancialPeriod,
) {
  const row = (
    await client.query(
      `WITH bounds AS (
    SELECT ($2::date::timestamp AT TIME ZONE $4) AS start_at,
           (($3::date+1)::timestamp AT TIME ZONE $4) AS end_at
  ), entries AS (
    SELECT e.*,e.created_at>=b.start_at AS in_period
    FROM loyalty_entries e CROSS JOIN bounds b
    WHERE e.store_id=$1 AND e.created_at<b.end_at
  ), wallets AS (
    SELECT membership_id,COALESCE(sum(amount) FILTER(WHERE NOT in_period),0) AS opening,
      sum(amount) AS closing FROM entries GROUP BY membership_id
  ) SELECT
    COALESCE((SELECT sum(amount) FROM entries WHERE in_period AND kind='earned'),0)::text AS issued,
    (-COALESCE((SELECT sum(amount) FROM entries WHERE in_period AND kind='redeemed'),0))::text AS redeemed,
    (-COALESCE((SELECT sum(amount) FROM entries WHERE in_period AND kind='refund_earned'),0))::text AS reversed,
    COALESCE((SELECT sum(amount) FROM entries WHERE in_period AND kind='refund_redeemed'),0)::text AS restored,
    COALESCE((SELECT sum(GREATEST(opening,0)) FROM wallets),0)::text AS "openingAvailable",
    COALESCE((SELECT sum(GREATEST(closing,0)) FROM wallets),0)::text AS "closingAvailable",
    COALESCE((SELECT sum(LEAST(opening,0)) FROM wallets),0)::text AS "openingNegative",
    COALESCE((SELECT sum(LEAST(closing,0)) FROM wallets),0)::text AS "closingNegative"`,
      [storeId, period.from, period.to, period.timezone],
    )
  ).rows[0];
  const amounts = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, fromScaled(toScaled(String(value), 2), 2)]),
  ) as Record<
    | 'issued'
    | 'redeemed'
    | 'reversed'
    | 'restored'
    | 'openingAvailable'
    | 'closingAvailable'
    | 'openingNegative'
    | 'closingNegative',
    string
  >;
  return {
    ...amounts,
    netRedeemed: fromScaled(toScaled(amounts.redeemed, 2) - toScaled(amounts.restored, 2), 2),
    netIssued: fromScaled(toScaled(amounts.issued, 2) - toScaled(amounts.reversed, 2), 2),
    valuation: 'face_value' as const,
    accountingModel: 'discount_on_redemption' as const,
  };
}
