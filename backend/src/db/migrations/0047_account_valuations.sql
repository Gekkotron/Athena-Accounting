-- Manual valuations for investment accounts.
--
-- An investment account (PEA, assurance-vie, crypto, ...) has a market value
-- that the transaction ledger cannot know: the book balance only tracks what
-- was paid in and out. A valuation is a user-entered snapshot of the real
-- value at a given date. The latest valuation at or before a date replaces
-- the book balance as the account's "Valeur"; the difference with the net
-- contributions ("Versé") is the unrealized gain (plus-value).
--
-- One valuation per (account, date): re-entering a date overwrites it.
-- `source` leaves room for future automated feeds; today it is always
-- 'manual'.

CREATE TABLE account_valuations (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  value      NUMERIC(14,2) NOT NULL,
  source     TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT account_valuations_account_date_uq UNIQUE (account_id, date)
);

CREATE INDEX account_valuations_user_idx ON account_valuations(user_id);
