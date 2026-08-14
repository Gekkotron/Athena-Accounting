CREATE TABLE fx_rates (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_ccy       VARCHAR(3) NOT NULL,
  to_ccy         VARCHAR(3) NOT NULL,
  effective_from DATE NOT NULL,
  rate           NUMERIC(20, 10) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fx_rates_from_ne_to CHECK (from_ccy <> to_ccy),
  CONSTRAINT fx_rates_rate_positive CHECK (rate > 0)
);

CREATE UNIQUE INDEX fx_rates_user_pair_effective_uq
  ON fx_rates (user_id, from_ccy, to_ccy, effective_from);

CREATE INDEX fx_rates_user_pair_effective_idx
  ON fx_rates (user_id, from_ccy, to_ccy, effective_from DESC);
