ALTER TABLE stores ADD COLUMN long_shift_threshold_hours integer NOT NULL DEFAULT 14 CHECK (long_shift_threshold_hours BETWEEN 1 AND 72);
