-- Manual reconciliation checkpoints per account. The user records a known
-- real balance on a given date (typically from a bank statement) and the
-- Dashboard chart plots it as a distinct marker. If the computed cumulative
-- diverges beyond one cent, the marker renders in a drift style with a short
-- guide line to the actual value. UI-only feature — no aggregate is derived
-- from this table server-side.

CREATE TABLE balance_checkpoints (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  checkpoint_date  DATE NOT NULL,
  expected_amount  NUMERIC(14, 2) NOT NULL,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT balance_checkpoints_account_date_uq UNIQUE (account_id, checkpoint_date)
);

CREATE INDEX balance_checkpoints_account_idx ON balance_checkpoints (account_id);
CREATE INDEX balance_checkpoints_user_idx    ON balance_checkpoints (user_id);
