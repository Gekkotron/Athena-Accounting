-- Loans — add a fixed-monthly-insurance override + extend the basis enum.
--
-- Users who mirror a bank schedule that quotes a flat monthly insurance
-- premium can now enter it directly: `insurance_monthly_amount` is NULL
-- for existing loans (the engine falls back to the rate × basis
-- computation) and takes an explicit decimal when the user wants a flat
-- premium.
--
-- The basis column also gains `remaining_annual` for the French bank
-- convention "révision annuelle" (premium recomputed on each loan
-- anniversary off the capital owed at that moment).

ALTER TABLE loans
  ADD COLUMN insurance_monthly_amount NUMERIC(14,2);

ALTER TABLE loans
  DROP CONSTRAINT loans_insurance_basis_chk;

ALTER TABLE loans
  ADD CONSTRAINT loans_insurance_basis_chk
    CHECK (insurance_basis IN ('initial', 'remaining', 'remaining_annual'));
