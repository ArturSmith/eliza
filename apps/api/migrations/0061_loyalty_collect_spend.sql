-- Cashiers now choose Collect or Spend after scanning the same membership QR.
-- Retain the legacy column for API/client compatibility; it is no longer configurable.
ALTER TABLE loyalty_programs ALTER COLUMN redeem_percent SET DEFAULT 100;
UPDATE loyalty_programs SET redeem_percent=100, version=version+1, updated_at=now() WHERE redeem_percent<>100;
