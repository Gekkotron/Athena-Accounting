-- User-controlled ordering of accounts. The dashboard and the Comptes tab
-- both honour this field so a single reorder propagates everywhere.
ALTER TABLE accounts ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;

-- Seed the order from the current alphabetical sort so existing instances
-- get a sensible default without surprise reshuffling on first deploy.
UPDATE accounts
SET display_order = sub.rn - 1
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY name) AS rn FROM accounts
) AS sub
WHERE accounts.id = sub.id;

-- Helpful for the ORDER BY display_order, name pattern.
CREATE INDEX accounts_display_order_idx ON accounts(display_order);
