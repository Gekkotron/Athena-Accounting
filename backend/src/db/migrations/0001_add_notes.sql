-- User-editable notes on transactions, kept distinct from `memo` (which is
-- bank-sourced from the OFX <MEMO> tag and should never be overwritten by
-- user input).
ALTER TABLE transactions ADD COLUMN notes TEXT;
