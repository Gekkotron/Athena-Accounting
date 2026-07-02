-- Lock-period support for PEA-style accounts. Money in an account with a
-- non-null `lock_years` is considered "blocked" until `opening_date +
-- lock_years` years — after which it becomes "available". Individual
-- transactions can override the account default with their own `lock_years`
-- (clocked from the transaction's own date), for cases where a specific
-- deposit has its own maturity.
--
-- Neither field is a hard constraint; nothing enforces that a "blocked"
-- amount cannot be spent. It is purely a reporting distinction so the
-- Dashboard can surface "available" vs "blocked" totals.

ALTER TABLE accounts
  ADD COLUMN lock_years INTEGER;

ALTER TABLE transactions
  ADD COLUMN lock_years INTEGER;

COMMENT ON COLUMN accounts.lock_years IS
  'Default lock period in years; applies to opening_balance and to any transaction whose own lock_years is null. Clocked from opening_date.';

COMMENT ON COLUMN transactions.lock_years IS
  'Per-transaction lock override in years. Clocked from the transaction date, not the account opening date.';
