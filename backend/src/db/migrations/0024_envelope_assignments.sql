-- Envelope assignments: per-month allocation per category. Under the
-- envelope model, income is allocated forward one month at a time;
-- this table stores those allocations. Amount may be negative — the
-- reallocation flow writes two rows atomically (source -= X, dest += X).
-- UNIQUE(user, category, month) => at most one assignment per envelope
-- per month. Month is stored as the first-of-month DATE.
CREATE TABLE envelope_assignments (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month        DATE    NOT NULL,
  amount       NUMERIC(14, 2) NOT NULL,
  currency     VARCHAR(3) NOT NULL DEFAULT 'EUR',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, category_id, month),
  CHECK (EXTRACT(DAY FROM month) = 1)
);
CREATE INDEX envelope_assignments_user_month_idx
  ON envelope_assignments (user_id, month);
