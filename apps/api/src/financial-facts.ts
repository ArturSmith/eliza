/** Trusted SQL fragments: immutable sale costs, provenance and cumulative refund rounding. */
export const saleCostColumns = `    COALESCE(i.cost_total,round(i.cost*i.quantity,2)) AS snapshot_cost,
    CASE WHEN i.cost_total IS NULL AND i.cost IS NULL THEN NULL
         WHEN EXISTS(SELECT 1 FROM sale_batch_allocations a
           JOIN stock_batches b ON b.id=a.batch_id AND b.store_id=a.store_id
           WHERE a.sale_item_id=i.id AND a.store_id=i.store_id AND b.cost_source='legacy_estimate') THEN NULL
         ELSE COALESCE(i.cost_total,round(i.cost*i.quantity,2)) END AS historical_cost`;

export const originalCostsCte = `original_lines AS (
  SELECT i.sale_id,i.product_id,i.quantity,
    ${saleCostColumns}
  FROM sale_items i WHERE i.store_id=$1
), original_costs AS (
  SELECT sale_id,product_id,sum(quantity) AS quantity,
    CASE WHEN count(*) FILTER(WHERE historical_cost IS NULL)>0 THEN NULL
      ELSE sum(historical_cost) END AS cost,
    CASE WHEN count(*) FILTER(WHERE snapshot_cost IS NULL)>0 THEN NULL
      ELSE sum(snapshot_cost) END AS snapshot_cost
  FROM original_lines GROUP BY sale_id,product_id
)`;

export const refundCostColumns = `    CASE WHEN h.cost IS NULL THEN NULL
      WHEN h.restored_cost IS NOT NULL THEN h.restored_cost
      WHEN h.original_quantity>0 THEN
        round(h.cost*(h.prior_returned+h.quantity)/h.original_quantity,2)-round(h.cost*h.prior_returned/h.original_quantity,2)
      ELSE NULL END AS historical_cost,
    CASE WHEN h.snapshot_cost IS NULL THEN NULL
      WHEN h.restored_cost IS NOT NULL THEN h.restored_cost
      WHEN h.original_quantity>0 THEN
        round(h.snapshot_cost*(h.prior_returned+h.quantity)/h.original_quantity,2)-round(h.snapshot_cost*h.prior_returned/h.original_quantity,2)
      ELSE NULL END AS snapshot_cost,
    h.cost IS NULL AND h.snapshot_cost IS NOT NULL AND NOT h.restock AS estimated_loss_cost`;
