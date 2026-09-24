-- A purchase order establishes a supplier/product relationship even before receipt.
-- Preserve manually maintained offers and skip cancelled orders.
WITH latest AS (
  SELECT DISTINCT ON (p.supplier_id, l.product_id)
    l.store_id, p.supplier_id, l.product_id, l.unit_cost
  FROM purchase_lines l
  JOIN purchases p ON p.id = l.purchase_id AND p.store_id = l.store_id
  WHERE p.status <> 'cancelled'
  ORDER BY p.supplier_id, l.product_id, p.created_at DESC, p.id DESC
), inserted AS (
  INSERT INTO supplier_products(store_id, supplier_id, product_id, pack_size, pack_cost)
  SELECT store_id, supplier_id, product_id, 1, unit_cost FROM latest
  ON CONFLICT (supplier_id, product_id) DO NOTHING
  RETURNING id, store_id, pack_size, pack_cost
)
INSERT INTO supplier_price_history(store_id, supplier_product_id, pack_size, pack_cost)
SELECT store_id, id, pack_size, pack_cost FROM inserted;
