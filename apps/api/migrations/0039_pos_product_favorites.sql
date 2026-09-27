CREATE TABLE pos_product_favorites (
 store_id uuid NOT NULL REFERENCES stores(id),
 employee_id uuid NOT NULL,
 product_id uuid NOT NULL,
 PRIMARY KEY(store_id,employee_id,product_id),
 FOREIGN KEY(employee_id,store_id) REFERENCES employees(id,store_id),
 FOREIGN KEY(product_id,store_id) REFERENCES products(id,store_id) ON DELETE CASCADE
);
CREATE INDEX pos_popularity_sales ON sales(store_id,created_at,id);
