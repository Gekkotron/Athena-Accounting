-- "Hold for next month" buffer. A hold on month M deducts from month
-- M's pool and releases into month M+1's pool. amount = 0 is invalid
-- (the route deletes the row instead of writing a 0).
CREATE TABLE envelope_month_holds (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month        DATE    NOT NULL,
  amount       NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month),
  CHECK (EXTRACT(DAY FROM month) = 1)
);
