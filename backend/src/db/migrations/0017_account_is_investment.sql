-- Third liquidity tier for the Dashboard: "placé".
--
-- The `lock_years` mechanism (migration 0011) covers money that is contractually
-- blocked (PEA, assurance-vie, dépôt à terme). A separate case is money the
-- user *chooses* to treat as invested even though it's not locked — typically
-- crypto exchange accounts (Binance, Kraken) where funds are technically
-- withdrawable but the user considers them a long-term placement.
--
-- `is_investment = true` flags such an account so the Dashboard can surface a
-- three-way breakdown: Disponible / Placé / Bloqué. Purely a reporting hint;
-- has no effect on the underlying balance math.

ALTER TABLE accounts
  ADD COLUMN is_investment BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN accounts.is_investment IS
  'User-flagged as an investment/placement account. Displayed as "Placé" on the Dashboard, distinct from lock_years-based "Bloqué".';
