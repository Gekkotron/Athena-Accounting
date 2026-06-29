-- file_imports gains two optional fields so the user can record the closing
-- balance printed on a bank statement and compare it against the system's
-- computed balance at the same date — a per-import reconciliation check.
--
-- Both columns are NULL-able: imports made before this migration (or imports
-- the user hasn't reconciled yet) simply have no stated balance and the UI
-- shows a "Renseigner" affordance to fill it in.

ALTER TABLE file_imports
  ADD COLUMN stated_balance NUMERIC(14, 2),
  ADD COLUMN stated_balance_date DATE;
