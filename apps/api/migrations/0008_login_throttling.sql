CREATE TABLE auth_attempts (
  key text PRIMARY KEY,
  count integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX auth_attempts_expiry ON auth_attempts(expires_at);
