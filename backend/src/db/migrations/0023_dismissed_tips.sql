-- Store dismissed tip ids per user. Value is a JSONB object mapping the
-- frozen tip id to the ISO-8601 dismissal timestamp. Missing key = not
-- dismissed. See docs/superpowers/specs/2026-07-16-tips-system-design.md.
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS dismissed_tips JSONB NOT NULL DEFAULT '{}'::jsonb;
