-- Fix-forward for a bug in migration 0021: the old uniqueness on
-- category_budgets was a TABLE-LEVEL UNIQUE (user_id, category_id) constraint
-- from migration 0015 (auto-named category_budgets_user_id_category_id_key),
-- not an index named category_budgets_user_category_idx. 0021's
-- DROP INDEX IF EXISTS silently no-oped, leaving the legacy constraint in
-- place — which rejects every legitimate budgets-v2 combination (monthly +
-- yearly on the same category, global + account-scoped on the same
-- (category, period)). Drop it here idempotently so existing DBs that
-- already applied 0021 recover, and fresh DBs get the same end state.
ALTER TABLE category_budgets
  DROP CONSTRAINT IF EXISTS category_budgets_user_id_category_id_key;
