-- Per-user configurable defaults (dashboard range, chart scope, chart gap
-- threshold, duplicate similarity threshold). One row per user, keyed by
-- user_id. Settings live in a JSONB blob so adding future keys does not
-- require a new migration — the app-layer Zod schema is the source of truth
-- for shape and bounds.

CREATE TABLE user_settings (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
