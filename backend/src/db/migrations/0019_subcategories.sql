-- 2-level category hierarchy. `parent_id` already exists (self-FK,
-- ON DELETE SET NULL). This migration scopes the uniqueness of category
-- names to (user_id, parent_id, name) instead of (user_id, name), so the
-- same leaf name (e.g. "Restaurant") can live under two different parents.
--
-- COALESCE(parent_id, 0) puts top-level rows into their own bucket, which
-- preserves the pre-existing "no two same-named top-level categories"
-- constraint. No data backfill needed: all existing rows have
-- parent_id = NULL, so the coalesced bucket for them is 0 and any
-- duplicates would already have been rejected by the old index.
DROP INDEX IF EXISTS categories_user_name_idx;
CREATE UNIQUE INDEX categories_user_parent_name_idx
  ON categories (user_id, COALESCE(parent_id, 0), name);
