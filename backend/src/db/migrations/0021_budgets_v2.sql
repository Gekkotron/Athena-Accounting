-- Budgets v2: add period (monthly | yearly) and optional per-account scope.
-- The old uniqueness was a single unique INDEX (not a constraint) named
-- category_budgets_user_category_idx. Replace it with two partial unique
-- indexes so that (a) NULL account_id still uniques the global slot per
-- (user, category, period), and (b) non-NULL account_id uniques per
-- (user, category, period, account_id). Postgres treats NULL as distinct in
-- a plain unique index — the partial split is what enforces the semantics.

ALTER TABLE category_budgets
  ADD COLUMN period text NOT NULL DEFAULT 'monthly'
    CHECK (period IN ('monthly','yearly')),
  ADD COLUMN account_id integer REFERENCES accounts(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS category_budgets_user_category_idx;

CREATE UNIQUE INDEX category_budgets_global_uniq
  ON category_budgets (user_id, category_id, period)
  WHERE account_id IS NULL;

CREATE UNIQUE INDEX category_budgets_scoped_uniq
  ON category_budgets (user_id, category_id, period, account_id)
  WHERE account_id IS NOT NULL;
