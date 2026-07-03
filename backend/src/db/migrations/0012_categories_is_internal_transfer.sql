-- Adds a per-category flag that marks the category as "internal movement"
-- (money moving between the user's own accounts, e.g. their "Économies"
-- category). Aggregates that already skip internal transfers via
-- `transactions.transfer_group_id IS NULL` now also treat rows in a
-- flagged category as internal — this covers users who never link mirror
-- legs and instead tag one side with a dedicated category.
--
-- Orthogonal to `kind`: a category can be `expense` AND flagged (a debit
-- that is really a self-transfer), or `income` AND flagged (the mirror
-- credit landing on the savings account). Defaults to FALSE so existing
-- categories behave exactly as before.

ALTER TABLE categories
  ADD COLUMN is_internal_transfer BOOLEAN NOT NULL DEFAULT FALSE;
