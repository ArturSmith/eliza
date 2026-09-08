UPDATE roles SET permissions=permissions || '["refund.approve"]'::jsonb WHERE name IN ('Owner','Manager');
CREATE SEQUENCE refund_number_sequence;
CREATE TABLE refunds(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL REFERENCES stores,
 sale_id uuid NOT NULL,shift_id uuid NOT NULL,employee_id uuid NOT NULL,device_id uuid NOT NULL,approver_id uuid NOT NULL,
 request_id uuid NOT NULL,request_hash text NOT NULL,number text NOT NULL,
 method text NOT NULL CHECK(method IN ('cash','card')),reason text NOT NULL,
 total numeric(14,2) NOT NULL CHECK(total>=0),tax numeric(14,2) NOT NULL CHECK(tax>=0),
 receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(store_id,request_id),UNIQUE(id,store_id),UNIQUE(store_id,number),
 FOREIGN KEY(sale_id,store_id) REFERENCES sales(id,store_id),
 FOREIGN KEY(shift_id,store_id) REFERENCES shifts(id,store_id),
 FOREIGN KEY(employee_id,store_id) REFERENCES employees(id,store_id),
 FOREIGN KEY(device_id,store_id) REFERENCES devices(id,store_id),
 FOREIGN KEY(approver_id,store_id) REFERENCES employees(id,store_id)
);
CREATE TABLE refund_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL REFERENCES stores,refund_id uuid NOT NULL,
 sale_id uuid NOT NULL,product_id uuid NOT NULL,quantity numeric(15,3) NOT NULL CHECK(quantity>0),
 restock boolean NOT NULL,total numeric(14,2) NOT NULL CHECK(total>=0),tax numeric(14,2) NOT NULL CHECK(tax>=0),
 UNIQUE(refund_id,product_id),FOREIGN KEY(refund_id,store_id) REFERENCES refunds(id,store_id),
 FOREIGN KEY(sale_id,store_id) REFERENCES sales(id,store_id),FOREIGN KEY(product_id,store_id) REFERENCES products(id,store_id)
);
ALTER TABLE cash_movements DROP CONSTRAINT cash_movements_kind_check;
ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_kind_check CHECK(kind IN ('opening','sale','in','out','refund'));
ALTER TABLE cash_movements ADD COLUMN refund_id uuid REFERENCES refunds;
ALTER TABLE movements ADD COLUMN refund_id uuid REFERENCES refunds;
CREATE INDEX refunds_store_date ON refunds(store_id,created_at);
CREATE INDEX refund_lines_sale ON refund_lines(sale_id,product_id);
CREATE TRIGGER immutable_refunds BEFORE UPDATE OR DELETE ON refunds FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE TRIGGER immutable_refund_lines BEFORE UPDATE OR DELETE ON refund_lines FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
