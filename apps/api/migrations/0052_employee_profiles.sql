ALTER TABLE employees
  ADD COLUMN first_name text,
  ADD COLUMN last_name text,
  ADD COLUMN birth_year integer CHECK (birth_year BETWEEN 1900 AND 9999),
  ADD COLUMN gender text CHECK (gender IN ('female','male','other','undisclosed')),
  ADD COLUMN phone text;
-- Existing display names stay intact; do not guess how to split personal names.
