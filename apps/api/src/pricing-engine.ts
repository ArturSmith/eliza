import type { PoolClient } from 'pg';
import { fromScaled, toScaled } from '@eliza/contracts';

export type PriceSource =
  'BASE' | 'PRODUCT_PROMOTION' | 'CATEGORY_PROMOTION' | 'MARKDOWN' | 'LEGACY_MARKDOWN';
export type ResolvedPrice = {
  price: string;
  basePrice: string;
  source: PriceSource;
  promotionId: string | null;
  markdownUnitId: string | null;
};

export async function resolvePrice(
  client: PoolClient,
  storeId: string,
  product: {
    id: string;
    price: string;
    category_id?: string | null;
    price_kind?: string;
    regular_price?: string | null;
    regularPrice?: string | null;
  },
  markdownUnitId?: string | null,
): Promise<ResolvedPrice> {
  const basePrice = product.price;
  if (markdownUnitId) {
    const unit = (
      await client.query(
        `SELECT u.id,u.status,m.final_unit_price::text AS price,m.base_unit_price::text AS base_price,
        (m.valid_from<=now() AND (m.valid_until IS NULL OR m.valid_until>now())) AS time_valid,m.cancelled_at,
        (b.quantity>=1 AND (b.expiry_date IS NULL OR
          b.expiry_date>(now() AT TIME ZONE s.timezone)::date)) AS batch_sellable
       FROM markdown_units u JOIN markdowns m ON m.id=u.markdown_id AND m.store_id=u.store_id
       JOIN stock_batches b ON b.id=u.batch_id AND b.store_id=u.store_id
       JOIN stores s ON s.id=u.store_id
       WHERE u.id=$1 AND u.store_id=$2 AND u.product_id=$3`,
        [markdownUnitId, storeId, product.id],
      )
    ).rows[0];
    if (!unit) throw new Error('Markdown label not found for this product.');
    if (
      unit.status !== 'AVAILABLE' ||
      unit.cancelled_at ||
      !unit.batch_sellable ||
      !unit.time_valid
    )
      throw new Error('Markdown label is no longer valid.');
    return {
      price: unit.price,
      basePrice: unit.base_price,
      source: 'MARKDOWN',
      promotionId: null,
      markdownUnitId,
    };
  }
  if (product.price_kind === 'limited_discount')
    return {
      price: basePrice,
      basePrice: product.regular_price ?? product.regularPrice ?? basePrice,
      source: 'LEGACY_MARKDOWN',
      promotionId: null,
      markdownUnitId: null,
    };
  const rows = (
    await client.query(
      `SELECT r.id,r.discount_type,r.discount_value::text AS value,
      CASE WHEN pp.product_id IS NOT NULL THEN 'PRODUCT_PROMOTION' ELSE 'CATEGORY_PROMOTION' END AS source
     FROM promotions r
     LEFT JOIN promotion_products pp ON pp.promotion_id=r.id AND pp.store_id=r.store_id AND pp.product_id=$2
     LEFT JOIN promotion_categories pc ON pc.promotion_id=r.id AND pc.store_id=r.store_id AND pc.category_id=$3
     WHERE r.store_id=$1 AND r.enabled AND r.cancelled_at IS NULL
       AND r.starts_at<=now() AND (r.ends_at IS NULL OR r.ends_at>now())
       AND (pp.product_id IS NOT NULL OR pc.category_id IS NOT NULL)
     ORDER BY CASE WHEN pp.product_id IS NOT NULL THEN 0 ELSE 1 END,r.id`,
      [storeId, product.id, product.category_id ?? null],
    )
  ).rows;
  const cents = toScaled(basePrice, 2);
  let best = cents;
  let source: PriceSource = 'BASE';
  let promotionId: string | null = null;
  for (const row of rows) {
    const candidate =
      row.discount_type === 'PERCENTAGE'
        ? (cents * (10000n - toScaled(row.value, 2)) + 5000n) / 10000n
        : toScaled(row.value, 2);
    if (candidate < best) {
      best = candidate;
      source = row.source;
      promotionId = row.id;
    }
  }
  return { price: fromScaled(best, 2), basePrice, source, promotionId, markdownUnitId: null };
}

export async function reservedByBatch(client: PoolClient, storeId: string, batchId: string) {
  const row = (
    await client.query(
      `SELECT count(*)::text AS count FROM markdown_units u JOIN markdowns m ON m.id=u.markdown_id
     WHERE u.store_id=$1 AND u.batch_id=$2 AND u.status='AVAILABLE'
       AND m.cancelled_at IS NULL
       AND (m.valid_until IS NULL OR m.valid_until>now())`,
      [storeId, batchId],
    )
  ).rows[0];
  return BigInt(row.count) * 1000n;
}
