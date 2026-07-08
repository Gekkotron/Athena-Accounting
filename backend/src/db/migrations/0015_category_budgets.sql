-- One recurring monthly spending limit per category. Budgets apply to
-- expense categories only (enforced at the app layer). No rollover, no
-- per-month history: editing the limit changes the comparison for every
-- month. UNIQUE(user_id, category_id) => at most one limit per category.
CREATE TABLE category_budgets (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  category_id   INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  monthly_limit NUMERIC(14, 2) NOT NULL CHECK (monthly_limit > 0),
  currency      VARCHAR(3) NOT NULL DEFAULT 'EUR',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, category_id)
);
CREATE INDEX category_budgets_user_idx ON category_budgets(user_id);
