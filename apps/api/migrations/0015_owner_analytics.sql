-- Owner analytics permissions. Existing roles keep their current reach: anyone who could
-- already read sales gains the dashboard, and only roles that could already see costs
-- gain profit, margin and inventory-valuation figures.
UPDATE roles SET permissions = permissions || '["analytics.view"]'::jsonb
 WHERE permissions ? 'sales.read' AND NOT permissions ? 'analytics.view';
UPDATE roles SET permissions = permissions || '["analytics.margin"]'::jsonb
 WHERE permissions ? 'costs.read' AND permissions ? 'sales.read' AND NOT permissions ? 'analytics.margin';

-- Analytics aggregates read sale lines by product and by sale. Without these the COGS
-- and product-ranking queries degrade to sequential scans as sales volume grows.
CREATE INDEX IF NOT EXISTS sale_items_store_product ON sale_items(store_id,product_id);
CREATE INDEX IF NOT EXISTS sale_items_sale ON sale_items(sale_id,product_id);
CREATE INDEX IF NOT EXISTS refund_lines_store_product ON refund_lines(store_id,product_id);
CREATE INDEX IF NOT EXISTS refunds_store_date ON refunds(store_id,created_at DESC);
CREATE INDEX IF NOT EXISTS movements_store_reason_date ON movements(store_id,reason,created_at DESC);
CREATE INDEX IF NOT EXISTS shifts_store_opened ON shifts(store_id,opened_at DESC);
CREATE INDEX IF NOT EXISTS goods_receipt_lines_product ON goods_receipt_lines(store_id,product_id);
