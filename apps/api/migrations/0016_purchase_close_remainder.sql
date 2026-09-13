ALTER TABLE purchases DROP CONSTRAINT purchases_status_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_status_check CHECK(status IN ('draft','ordered','partially_received','received','cancelled','closed'));
ALTER TABLE purchases ADD COLUMN close_reason text NOT NULL DEFAULT '';
ALTER TABLE purchases ADD COLUMN closed_at timestamptz;
ALTER TABLE purchases ADD COLUMN closed_by uuid;
ALTER TABLE purchases ADD CONSTRAINT purchases_closed_actor FOREIGN KEY(closed_by,store_id) REFERENCES employees(id,store_id);
ALTER TABLE purchases ADD CONSTRAINT purchases_closure CHECK((status='closed') = (closed_at IS NOT NULL AND closed_by IS NOT NULL AND length(trim(close_reason))>0));
