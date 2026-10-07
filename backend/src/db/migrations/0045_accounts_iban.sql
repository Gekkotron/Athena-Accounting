-- Optional manual IBAN for an account. Synced accounts keep deriving their
-- IBAN from bank_connection_accounts.iban (the authoritative source); this
-- column holds the user-entered fallback for accounts that aren't linked to
-- a bank connection. The accounts list endpoint returns
-- COALESCE(synced, manual) and flags the field as locked when a synced
-- value exists, so the frontend can disable editing in that case.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS iban TEXT;
