-- Fold the `is_investment` boolean into the `type` column.
--
-- Migration 0017 introduced `is_investment` as a separate reporting flag on
-- accounts (crypto exchange, brokerage, etc. — displayed as "Placé" on the
-- Dashboard). It always coexisted with `type`, but from the user's perspective
-- an account is either a checking / savings / credit / other / *investment*
-- account — never both. Two orthogonal knobs where one suffices.
--
-- This migration promotes "investment" to a first-class `type` value:
--   1. Every account currently flagged `is_investment = true` becomes
--      `type = 'investment'` (its previous type is discarded — the flag is the
--      one that mattered for the Dashboard breakdown).
--   2. The `is_investment` column is dropped.
--
-- The Dashboard's "Placé" tier is now derived from `type = 'investment'`
-- (see reports.ts).

UPDATE accounts
  SET type = 'investment'
  WHERE is_investment = TRUE;

ALTER TABLE accounts
  DROP COLUMN is_investment;
