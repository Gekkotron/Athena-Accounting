-- Detected recurring transaction series. The detector groups a user's
-- transactions by (fuzzy label similarity, cadence bucket, amount
-- tolerance) and emits one row here per repeating pattern. Users can
-- Confirm or Dismiss the auto-detection and tag a series as essential
-- vs discretionary; those decisions are preserved when detection
-- re-runs (deleting only rows still in status='detected' that no
-- longer match).
--
-- Design notes:
--   * date fields are DATE, not TIMESTAMPTZ — the underlying
--     transactions.date column is DATE, so next_due_at arithmetic
--     stays day-granular and free of timezone gymnastics.
--   * category_id is nullable: when the member transactions span
--     several categories the detector leaves it NULL rather than
--     picking a lossy majority; UI groups those under "Sans catégorie".
--   * UNIQUE(user_id, label, cadence_days) ensures re-running
--     detection is idempotent for a given (merchant, cadence) pair —
--     the same merchant billed at two different cadences (rare, but
--     possible: weekly top-up + monthly subscription) coexists as two
--     rows.
CREATE TYPE recurring_status AS ENUM ('detected', 'confirmed', 'dismissed');
CREATE TYPE recurring_essentialness AS ENUM ('essential', 'discretionary');

CREATE TABLE recurring_series (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  label          TEXT    NOT NULL,
  cadence_days   INTEGER NOT NULL CHECK (cadence_days > 0),
  avg_amount     NUMERIC(14, 2) NOT NULL,
  amount_stddev  NUMERIC(14, 2) NOT NULL DEFAULT 0,
  category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  first_seen_at  DATE    NOT NULL,
  last_seen_at   DATE    NOT NULL,
  next_due_at    DATE    NOT NULL,
  status         recurring_status        NOT NULL DEFAULT 'detected',
  essentialness  recurring_essentialness,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, label, cadence_days)
);

CREATE INDEX recurring_series_user_status_idx
  ON recurring_series (user_id, status);
CREATE INDEX recurring_series_next_due_idx
  ON recurring_series (user_id, next_due_at);

-- Membership: which transactions contributed to each series. Cascades
-- both ways: deleting a series drops its join rows; deleting a
-- transaction drops its membership (the series is recomputed at the
-- next regenerate).
CREATE TABLE recurring_series_transactions (
  series_id       INTEGER NOT NULL REFERENCES recurring_series(id) ON DELETE CASCADE,
  transaction_id  BIGINT  NOT NULL REFERENCES transactions(id)     ON DELETE CASCADE,
  PRIMARY KEY (series_id, transaction_id)
);

CREATE INDEX recurring_series_transactions_tx_idx
  ON recurring_series_transactions (transaction_id);
