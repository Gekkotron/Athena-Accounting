-- Per-row "this row has been validated as NOT a duplicate" flag, used by the
-- Imports → Possibles doublons panel to dismiss legitimate same-day/same-amount
-- pairs (two coffees at the same café, etc.).
--
-- A group disappears from the panel only when every row in it is marked. If a
-- new row later arrives with the same (account, date, amount) and a different
-- dedup_key, the group reappears (because the new row is unmarked) — so the
-- user can re-evaluate.

ALTER TABLE transactions
  ADD COLUMN not_duplicate BOOLEAN NOT NULL DEFAULT false;
