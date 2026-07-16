-- Per-envelope config: optional target (goal amount + optional date +
-- kind) and the overspend policy. Row exists only when the user
-- configures something. Absence = defaults (rollover_negative, no target).
-- Composite PK on (user_id, category_id) — one settings row per envelope.
CREATE TABLE envelope_category_settings (
  user_id           INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  category_id       INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  target_amount     NUMERIC(14, 2),
  target_date       DATE,
  target_kind       TEXT
                    CHECK (target_kind IN
                      ('save_by_date', 'monthly_recurring', 'save_up_to')),
  overspend_policy  TEXT NOT NULL DEFAULT 'rollover_negative'
                    CHECK (overspend_policy IN
                      ('rollover_negative', 'reallocate_manual')),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category_id)
);
