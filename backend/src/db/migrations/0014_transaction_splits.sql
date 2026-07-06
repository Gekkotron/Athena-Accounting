-- Splits: one row per (transaction, category, portion). A transaction is
-- either single-category (no rows here; use transactions.category_id) OR
-- ventilated across N >= 2 splits whose amounts sum to parent.amount.

CREATE TABLE transaction_splits (
  id             SERIAL PRIMARY KEY,
  transaction_id BIGINT NOT NULL
                   REFERENCES transactions(id) ON DELETE CASCADE,
  category_id    INTEGER
                   REFERENCES categories(id) ON DELETE SET NULL,
  amount         NUMERIC(14, 2) NOT NULL,
  memo           TEXT
);
CREATE INDEX transaction_splits_tx_idx  ON transaction_splits(transaction_id);
CREATE INDEX transaction_splits_cat_idx ON transaction_splits(category_id);

-- Checksum trigger: on any splits mutation, SUM(amount) for the affected
-- parent must equal parent.amount OR be 0 (0 = no splits, parent.category_id
-- is authoritative). DEFERRABLE so a delete-then-insert atomic replace
-- inside a single BEGIN/COMMIT is valid at commit time.
CREATE OR REPLACE FUNCTION transaction_splits_checksum()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  parent_id      BIGINT;
  parent_amount  NUMERIC(14, 2);
  splits_sum     NUMERIC(14, 2);
BEGIN
  parent_id := COALESCE(NEW.transaction_id, OLD.transaction_id);
  SELECT amount INTO parent_amount FROM transactions WHERE id = parent_id;
  IF parent_amount IS NULL THEN
    -- Parent already gone (CASCADE from transactions.DELETE). Nothing to check.
    RETURN NULL;
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO splits_sum
    FROM transaction_splits WHERE transaction_id = parent_id;
  IF splits_sum <> 0 AND splits_sum <> parent_amount THEN
    RAISE EXCEPTION
      'transaction_splits sum mismatch: parent=% splits=%',
      parent_amount, splits_sum
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER transaction_splits_checksum_trg
  AFTER INSERT OR UPDATE OR DELETE ON transaction_splits
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION transaction_splits_checksum();

-- Amount-lock trigger: reject UPDATE transactions SET amount = ... while
-- the parent has splits. Prevents silent invariant drift.
CREATE OR REPLACE FUNCTION transactions_amount_lock_when_split()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount <> OLD.amount
     AND EXISTS (SELECT 1 FROM transaction_splits
                  WHERE transaction_id = OLD.id) THEN
    RAISE EXCEPTION
      'cannot change transaction amount while splits exist'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER transactions_amount_lock_when_split_trg
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION transactions_amount_lock_when_split();
