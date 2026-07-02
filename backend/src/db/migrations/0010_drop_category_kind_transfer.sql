-- Retire the 'transfer' value from the category_kind palette.
-- Internal transfers are already modelled by transfer_group_id on
-- transactions + the transfer_rules table; having a redundant category
-- kind for the same idea only creates confusion. Existing rows using
-- 'transfer' are coerced to 'neutral' so no data is lost.
--
-- The Postgres enum type itself keeps 'transfer' in its value list
-- (removing an enum value in place is expensive and requires rewriting
-- every column referencing the enum). Application-level validation
-- (Zod) refuses the value going forward, so it will simply become
-- unreachable.

UPDATE categories SET kind = 'neutral' WHERE kind = 'transfer';
