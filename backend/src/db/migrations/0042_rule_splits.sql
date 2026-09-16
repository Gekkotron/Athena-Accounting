-- Rule-driven auto-splits (spec: docs/superpowers/specs/2026-09-16-rule-auto-splits-design.md).
-- Two schema changes plus one constraint trigger:
--
-- 1. rule_splits — companion table that hangs off rules via CASCADE. Presence
--    of one or more rows for a given rule flips the engine from single-category
--    mode to split mode. `rules.category_id` stays NOT NULL and acts as the
--    "primary / display" category (the one shown in listings and the one
--    stamped on the parent transaction so single-category filters still find
--    it). Percentages sum to exactly 100, enforced by the deferrable trigger
--    below.
CREATE TABLE rule_splits (
  id           SERIAL PRIMARY KEY,
  rule_id      INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  percent      INTEGER NOT NULL CHECK (percent BETWEEN 1 AND 99),
  position     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX rule_splits_rule_idx ON rule_splits (rule_id);

-- 2. transactions.splits_source — tracks the ventilation's origin
--    independently of category_source. The two lifecycles legitimately
--    diverge: a user can accept an auto-emitted split, then re-tag the
--    parent's primary category without touching the ventilation. Overloading
--    category_source would over- or under-preserve. NULL = no splits (or
--    splits cleared).
ALTER TABLE transactions
  ADD COLUMN splits_source category_source;

-- 3. Sum-guard trigger mirrors migration 0014's transaction_splits_checksum.
--    Zero rows is legal (rule reverts to single-category mode); any other
--    total besides 100 fails at commit.
CREATE OR REPLACE FUNCTION rule_splits_percent_checksum()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  rid   INTEGER;
  total INTEGER;
BEGIN
  rid := COALESCE(NEW.rule_id, OLD.rule_id);
  SELECT COALESCE(SUM(percent), 0) INTO total
    FROM rule_splits WHERE rule_id = rid;
  IF total <> 0 AND total <> 100 THEN
    RAISE EXCEPTION
      'rule_splits percents must sum to 100 (rule_id=%, total=%)',
      rid, total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER rule_splits_percent_checksum_trg
  AFTER INSERT OR UPDATE OR DELETE ON rule_splits
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION rule_splits_percent_checksum();
