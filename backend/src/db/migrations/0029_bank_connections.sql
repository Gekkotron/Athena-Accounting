-- Bank connections for the optional Enable Banking sync connector
-- (part 2 of the bank-sync feature; credentials landed in 0028).
--
-- One bank_connections row per authorized PSD2 consent session. The consent
-- expires at valid_until (90–180 days, bank-dependent); an expired or revoked
-- session flips status to 'needs_reconnect' instead of erroring so the UI can
-- prompt for a re-authorization.
--
-- bank_connection_accounts snapshots the accounts Enable Banking returned at
-- session creation (uid + display metadata) and carries the user's mapping to
-- an Athena account. account_id is nullable: NULL means "not mapped" — the
-- sync engine skips unmapped rows. ON DELETE SET NULL keeps the connection
-- alive when an Athena account is deleted; the row simply becomes unmapped.
CREATE TYPE bank_connection_status AS ENUM ('active', 'needs_reconnect');

CREATE TABLE bank_connections (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id     TEXT    NOT NULL,
  aspsp_name     TEXT    NOT NULL,
  aspsp_country  TEXT    NOT NULL DEFAULT 'FR',
  valid_until    DATE    NOT NULL,
  status         bank_connection_status NOT NULL DEFAULT 'active',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX bank_connections_user_idx ON bank_connections (user_id);

CREATE TABLE bank_connection_accounts (
  id                SERIAL PRIMARY KEY,
  connection_id     INTEGER NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
  bank_account_uid  TEXT    NOT NULL,
  iban              TEXT,
  name              TEXT,
  currency          TEXT,
  account_id        INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  last_synced_at    TIMESTAMPTZ,
  UNIQUE (connection_id, bank_account_uid)
);

CREATE INDEX bank_connection_accounts_connection_idx
  ON bank_connection_accounts (connection_id);
