-- The rule-driven transfer detector was removed. The transfer_rules table
-- and its transfer_direction enum are dropped; existing transactions keep
-- their transfer_group_id column untouched (readers across the codebase
-- still rely on it — transaction filters, splits guards, delete ripple,
-- account merge, reports).
DROP TABLE IF EXISTS transfer_rules;
DROP TYPE IF EXISTS transfer_direction;
