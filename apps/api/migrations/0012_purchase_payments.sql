ALTER TABLE purchases
 ADD COLUMN payment_status text NOT NULL DEFAULT 'unrecorded' CHECK (payment_status IN ('unrecorded','unpaid','paid')),
 ADD COLUMN payment_due_date date,
 ADD COLUMN paid_at timestamptz;
ALTER TABLE purchases ALTER COLUMN payment_status SET DEFAULT 'unpaid';
ALTER TABLE purchases ADD CONSTRAINT purchase_payment_consistency CHECK ((payment_status='paid') = (paid_at IS NOT NULL));
