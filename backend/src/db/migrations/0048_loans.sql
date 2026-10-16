-- Loans (emprunts) and saved loan simulations.
--
-- A row stores only the loan's INPUTS: capital, rates, insurance, fees and
-- a timeline of periods + early repayments (jsonb, validated by zod on
-- write). The month-by-month schedule and the totals are recomputed by
-- backend/src/domain/loans/engine on every read, so a fix to the engine
-- never needs a data migration.
--
-- is_simulation separates what-if scenarios from real loans;
-- source_loan_id points a scenario at the loan it was derived from and is
-- nulled (not cascaded) when that loan is deleted, so the scenario survives.

CREATE TABLE loans (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'other',
  is_simulation    BOOLEAN NOT NULL DEFAULT false,
  source_loan_id   INTEGER REFERENCES loans(id) ON DELETE SET NULL,
  currency         VARCHAR(3) NOT NULL DEFAULT 'EUR',
  principal        NUMERIC(14,2) NOT NULL,
  start_date       DATE NOT NULL,
  annual_rate      NUMERIC(7,4) NOT NULL,
  insurance_rate   NUMERIC(7,4) NOT NULL DEFAULT 0,
  insurance_basis  TEXT NOT NULL DEFAULT 'initial',
  fees             NUMERIC(14,2) NOT NULL DEFAULT 0,
  periods          JSONB NOT NULL DEFAULT '[]'::jsonb,
  final_period     JSONB NOT NULL,
  early_repayments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT loans_user_name_uq UNIQUE (user_id, name),
  CONSTRAINT loans_kind_chk CHECK (kind IN ('mortgage', 'consumer', 'auto', 'other')),
  CONSTRAINT loans_insurance_basis_chk CHECK (insurance_basis IN ('initial', 'remaining'))
);

CREATE INDEX loans_user_idx ON loans(user_id);
