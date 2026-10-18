import { ConflictException } from '@nestjs/common';
import { fromScaled, toScaled } from '@eliza/contracts';
import type { PoolClient } from 'pg';
import { reservedByBatch } from './pricing-engine.js';

// Call only while holding the product row lock, inside the stock-changing transaction.
export async function addUnknownStock(
  c: PoolClient,
  storeId: string,
  productId: string,
  quantity: string,
  historicalCost: string | null = null,
) {
  if (historicalCost === null) {
    const result = await c.query('SELECT cost FROM products WHERE store_id=$1 AND id=$2', [
      storeId,
      productId,
    ]);
    if (result.rows[0]?.cost == null)
      throw new ConflictException('Set purchase cost before adding stock.');
  }
  await c.query(
    `INSERT INTO stock_batches(store_id,product_id,quantity,unit_cost,cost_source)
     SELECT $1,$2,$3,COALESCE($4::numeric,cost),CASE WHEN $4::numeric IS NULL THEN 'adjustment' ELSE 'legacy_estimate' END FROM products WHERE store_id=$1 AND id=$2`,
    [storeId, productId, quantity, historicalCost],
  );
}

export async function consumeBatches(
  c: PoolClient,
  storeId: string,
  productId: string,
  quantity: string,
  options: { saleItemId?: string; markdownBatchId?: string } = {},
) {
  let remaining = toScaled(quantity, 3);
  let totalCost = 0n;
  const rows = (
    await c.query(
      `SELECT id,quantity::text,expiry_date,unit_cost::text FROM stock_batches
       WHERE store_id=$1 AND product_id=$2 AND quantity>0
         AND ($4::uuid IS NULL OR id=$4)
         AND ($3::boolean OR expiry_date IS NULL OR expiry_date>(now() AT TIME ZONE
           (SELECT timezone FROM stores WHERE id=$1))::date)
       ORDER BY expiry_date ASC NULLS LAST,created_at,id
       FOR UPDATE`,
      [storeId, productId, !options.saleItemId, options.markdownBatchId ?? null],
    )
  ).rows;
  for (const row of rows) {
    if (remaining === 0n) break;
    const reserved = options.markdownBatchId ? 0n : await reservedByBatch(c, storeId, row.id);
    const free = toScaled(row.quantity, 3) - reserved;
    if (free <= 0n) continue;
    const taken = remaining < free ? remaining : free;
    await c.query('UPDATE stock_batches SET quantity=quantity-$2 WHERE id=$1', [
      row.id,
      fromScaled(taken, 3),
    ]);
    const cost = (toScaled(row.unit_cost, 2) * taken + 500n) / 1000n;
    totalCost += cost;
    if (options.saleItemId)
      await c.query(
        'INSERT INTO sale_batch_allocations(store_id,sale_item_id,batch_id,quantity,unit_cost,cost_total) VALUES($1,$2,$3,$4,$5,$6)',
        [
          storeId,
          options.saleItemId,
          row.id,
          fromScaled(taken, 3),
          row.unit_cost,
          fromScaled(cost, 2),
        ],
      );
    remaining -= taken;
  }
  if (remaining > 0n)
    throw new ConflictException(
      options.saleItemId
        ? 'Not enough unexpired stock. Remove expired items or correct the stock count.'
        : 'Batch stock is lower than the product stock. Reconcile this product before changing it.',
    );
  return fromScaled(totalCost, 2);
}

export async function restockSaleBatches(
  c: PoolClient,
  storeId: string,
  saleId: string,
  productId: string,
  refundLineId: string,
  quantity: string,
  restock: boolean,
  saleItemId?: string,
) {
  let remaining = toScaled(quantity, 3);
  let restoredCost = 0n;
  let legacy = false;
  const rows = (
    await c.query(
      `SELECT a.id,a.batch_id,a.quantity::text,a.cost_total::text,
         COALESCE((SELECT sum(r.quantity) FROM refund_batch_allocations r WHERE r.sale_batch_allocation_id=a.id),0)::text AS returned
       FROM sale_batch_allocations a
       JOIN sale_items i ON i.id=a.sale_item_id AND i.store_id=a.store_id
       JOIN stock_batches b ON b.id=a.batch_id AND b.store_id=a.store_id
       WHERE a.store_id=$1 AND i.sale_id=$2 AND i.product_id=$3
         AND ($4::uuid IS NULL OR i.id=$4)
       ORDER BY b.expiry_date ASC NULLS LAST,b.created_at,b.id FOR UPDATE OF a`,
      [storeId, saleId, productId, saleItemId ?? null],
    )
  ).rows;
  for (const row of rows) {
    if (remaining === 0n) break;
    const available = toScaled(row.quantity, 3) - toScaled(row.returned, 3);
    const taken = remaining < available ? remaining : available;
    if (taken <= 0n) continue;
    if (row.cost_total === null) legacy = true;
    else {
      const cost = toScaled(row.cost_total, 2);
      const sold = toScaled(row.quantity, 3);
      const returned = toScaled(row.returned, 3);
      restoredCost +=
        (cost * (returned + taken) + sold / 2n) / sold - (cost * returned + sold / 2n) / sold;
    }
    if (restock)
      await c.query('UPDATE stock_batches SET quantity=quantity+$2 WHERE id=$1', [
        row.batch_id,
        fromScaled(taken, 3),
      ]);
    await c.query(
      'INSERT INTO refund_batch_allocations(store_id,refund_line_id,sale_batch_allocation_id,quantity) VALUES($1,$2,$3,$4)',
      [storeId, refundLineId, row.id, fromScaled(taken, 3)],
    );
    remaining -= taken;
  }
  if (remaining > 0n) legacy = true;
  // Sales from before the migration have no allocation history.
  if (remaining > 0n && restock) {
    const historical = (
      await c.query(
        'SELECT round(sum(COALESCE(cost_total,round(cost*quantity,2)))/NULLIF(sum(quantity),0),2)::text AS cost FROM sale_items WHERE store_id=$1 AND sale_id=$2 AND product_id=$3 AND ($4::uuid IS NULL OR id=$4)',
        [storeId, saleId, productId, saleItemId ?? null],
      )
    ).rows[0];
    await addUnknownStock(
      c,
      storeId,
      productId,
      fromScaled(remaining, 3),
      historical?.cost ?? null,
    );
  }
  return legacy ? null : fromScaled(restoredCost, 2);
}
