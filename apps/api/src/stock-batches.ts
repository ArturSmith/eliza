import { ConflictException } from '@nestjs/common';
import { fromScaled, toScaled } from '@eliza/contracts';
import type { PoolClient } from 'pg';

// Call only while holding the product row lock, inside the stock-changing transaction.
export async function addUnknownStock(
  c: PoolClient,
  storeId: string,
  productId: string,
  quantity: string,
) {
  await c.query(
    `INSERT INTO stock_batches(store_id,product_id,quantity) VALUES($1,$2,$3)
     ON CONFLICT(store_id,product_id) WHERE receipt_line_id IS NULL AND expiry_date IS NULL
     DO UPDATE SET quantity=stock_batches.quantity+EXCLUDED.quantity`,
    [storeId, productId, quantity],
  );
}

export async function consumeBatches(
  c: PoolClient,
  storeId: string,
  productId: string,
  quantity: string,
  options: { saleItemId?: string } = {},
) {
  let remaining = toScaled(quantity, 3);
  const rows = (
    await c.query(
      `SELECT id,quantity::text,expiry_date FROM stock_batches
       WHERE store_id=$1 AND product_id=$2 AND quantity>0
         AND ($3::boolean OR expiry_date IS NULL OR expiry_date>(now() AT TIME ZONE
           (SELECT timezone FROM stores WHERE id=$1))::date)
       ORDER BY expiry_date ASC NULLS LAST,created_at,id
       FOR UPDATE`,
      [storeId, productId, !options.saleItemId],
    )
  ).rows;
  for (const row of rows) {
    if (remaining === 0n) break;
    const taken = remaining < toScaled(row.quantity, 3) ? remaining : toScaled(row.quantity, 3);
    await c.query('UPDATE stock_batches SET quantity=quantity-$2 WHERE id=$1', [
      row.id,
      fromScaled(taken, 3),
    ]);
    if (options.saleItemId)
      await c.query(
        'INSERT INTO sale_batch_allocations(store_id,sale_item_id,batch_id,quantity) VALUES($1,$2,$3,$4)',
        [storeId, options.saleItemId, row.id, fromScaled(taken, 3)],
      );
    remaining -= taken;
  }
  if (remaining > 0n)
    throw new ConflictException(
      options.saleItemId
        ? 'Not enough unexpired stock. Remove expired items or correct the stock count.'
        : 'Batch stock is lower than the product stock. Reconcile this product before changing it.',
    );
}

export async function restockSaleBatches(
  c: PoolClient,
  storeId: string,
  saleId: string,
  productId: string,
  refundLineId: string,
  quantity: string,
  restock: boolean,
) {
  let remaining = toScaled(quantity, 3);
  const rows = (
    await c.query(
      `SELECT a.id,a.batch_id,a.quantity::text,
         COALESCE((SELECT sum(r.quantity) FROM refund_batch_allocations r WHERE r.sale_batch_allocation_id=a.id),0)::text AS returned
       FROM sale_batch_allocations a
       JOIN sale_items i ON i.id=a.sale_item_id AND i.store_id=a.store_id
       JOIN stock_batches b ON b.id=a.batch_id AND b.store_id=a.store_id
       WHERE a.store_id=$1 AND i.sale_id=$2 AND i.product_id=$3
       ORDER BY b.expiry_date ASC NULLS LAST,b.created_at,b.id FOR UPDATE OF a`,
      [storeId, saleId, productId],
    )
  ).rows;
  for (const row of rows) {
    if (remaining === 0n) break;
    const available = toScaled(row.quantity, 3) - toScaled(row.returned, 3);
    const taken = remaining < available ? remaining : available;
    if (taken <= 0n) continue;
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
  // Sales from before the migration have no allocation history.
  if (remaining > 0n && restock)
    await addUnknownStock(c, storeId, productId, fromScaled(remaining, 3));
}
