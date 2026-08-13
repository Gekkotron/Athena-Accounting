-- Savings goals ("piggy banks") — a layer of intent on top of an account's
-- real balance. See docs/superpowers/specs/2026-08-13-savings-goals-design.md.
-- Goals do not touch the ledger; contributions are explicit events recorded
-- against the goal, so many goals can co-exist on the same account without
-- an arbitrary weighting of the shared balance.

CREATE TABLE savings_goals (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  target_amount NUMERIC(14,2) NOT NULL CHECK (target_amount > 0),
  target_date   DATE,
  color         VARCHAR(9),
  closed_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT savings_goals_user_account_name_uq UNIQUE (user_id, account_id, name)
);

CREATE INDEX savings_goals_user_idx    ON savings_goals(user_id);
CREATE INDEX savings_goals_account_idx ON savings_goals(account_id);

-- Positive amount = contribution, negative = withdrawal. Same signed
-- convention as transactions.amount. Zero is disallowed — an accidental
-- zero-amount event corrupts justReached math and clutters the drawer.
CREATE TABLE savings_goal_events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id     INTEGER NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount <> 0),
  event_date  DATE NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX savings_goal_events_goal_date_idx ON savings_goal_events(goal_id, event_date DESC);
CREATE INDEX savings_goal_events_user_idx      ON savings_goal_events(user_id);
