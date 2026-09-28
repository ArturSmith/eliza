import type { PoolClient } from 'pg';
export async function shoppingProducts(c: PoolClient, store: string, ids: string[] | null = null) {
  return (
    await c.query(
      `
    WITH supply AS (
      SELECT l.product_id,
        COALESCE(sum(CASE WHEN o.status IN ('ordered','partially_received') THEN l.ordered_quantity-l.received_quantity ELSE 0 END),0)::text AS incoming,
        COALESCE(sum(CASE WHEN o.status='draft' THEN l.ordered_quantity ELSE 0 END),0)::text AS drafts
      FROM purchase_lines l JOIN purchases o ON o.id=l.purchase_id
      WHERE o.store_id=$1 AND o.status IN ('draft','ordered','partially_received') GROUP BY l.product_id
    )
    SELECT p.id AS "productId",p.name,p.sku,p.category,p.unit,p.active,p.stock,p.min_stock AS "minStock",
      p.cost AS "unitCost",p.tax_rate AS "taxRate",
      COALESCE(s.incoming,'0') AS incoming,COALESCE(s.drafts,'0') AS drafts,
      r.target_stock AS "preferredTarget",r.supplier_id AS "preferredSupplierId"
    FROM products p LEFT JOIN supply s ON s.product_id=p.id
    LEFT JOIN reorder_preferences r ON r.product_id=p.id
    WHERE p.store_id=$1 AND ($2::uuid[] IS NULL OR p.id=ANY($2::uuid[]))
    ORDER BY p.id`,
      [store, ids],
    )
  ).rows;
}
