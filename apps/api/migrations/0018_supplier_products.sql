-- Which suppliers can sell which products, and at what quoted price.
-- Distinct from reorder_preferences, which records the single preferred supplier
-- used to pre-fill shopping lists. A product may be listed by many suppliers.
CREATE TABLE supplier_products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES stores,
 supplier_id uuid NOT NULL,
 product_id uuid NOT NULL,
 supplier_sku text NOT NULL DEFAULT '',
 -- Quoted cost is per pack; pack_size converts it to the product's own selling
 -- unit. Comparing pack prices across suppliers with different pack sizes would
 -- rank them wrongly, so every comparison divides by pack_size.
 pack_size numeric(15,3) NOT NULL DEFAULT 1 CHECK(pack_size>0),
 pack_cost numeric(14,2) NOT NULL CHECK(pack_cost>=0),
 lead_time_days integer CHECK(lead_time_days IS NULL OR lead_time_days>=0),
 minimum_order numeric(15,3) CHECK(minimum_order IS NULL OR minimum_order>0),
 notes text NOT NULL DEFAULT '',
 active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(supplier_id,product_id),
 UNIQUE(id,store_id),
 FOREIGN KEY(supplier_id,store_id) REFERENCES suppliers(id,store_id),
 FOREIGN KEY(product_id,store_id) REFERENCES products(id,store_id)
);
CREATE INDEX supplier_products_supplier ON supplier_products(store_id,supplier_id) WHERE active;
CREATE INDEX supplier_products_product ON supplier_products(store_id,product_id) WHERE active;

-- Append-only record of quoted price changes. Actual paid prices already live in
-- goods_receipt_lines; this tracks what suppliers say they will charge.
CREATE TABLE supplier_price_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES stores,
 supplier_product_id uuid NOT NULL,
 pack_size numeric(15,3) NOT NULL CHECK(pack_size>0),
 pack_cost numeric(14,2) NOT NULL CHECK(pack_cost>=0),
 employee_id uuid,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(supplier_product_id,store_id) REFERENCES supplier_products(id,store_id),
 FOREIGN KEY(employee_id,store_id) REFERENCES employees(id,store_id)
);
CREATE INDEX supplier_price_history_product ON supplier_price_history(supplier_product_id,recorded_at DESC);

-- Seed the catalogue from what has actually been delivered, so the feature is
-- useful immediately instead of starting empty. Pack size is left at 1 because
-- historical receipts recorded cost per selling unit, not per pack.
INSERT INTO supplier_products(store_id,supplier_id,product_id,pack_cost,pack_size)
SELECT DISTINCT ON (p.supplier_id,l.product_id)
 l.store_id,p.supplier_id,l.product_id,l.unit_cost,1
FROM goods_receipt_lines l
JOIN goods_receipts r ON r.id=l.receipt_id AND r.store_id=l.store_id
JOIN purchases p ON p.id=r.purchase_id AND p.store_id=r.store_id
ORDER BY p.supplier_id,l.product_id,r.created_at DESC
ON CONFLICT (supplier_id,product_id) DO NOTHING;

INSERT INTO supplier_price_history(store_id,supplier_product_id,pack_size,pack_cost)
SELECT store_id,id,pack_size,pack_cost FROM supplier_products;
