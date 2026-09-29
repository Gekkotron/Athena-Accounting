-- Nullable closing date for an account. When set, the account is displayed
-- with a "closed" badge; balance math and bank sync are unaffected for now.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS closed_at DATE;
