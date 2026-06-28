-- Athena Accounting — initial schema
-- This SQL is the source applied by src/db/migrate.ts.
-- Keep it in sync with src/db/schema.ts (the Drizzle definition used at runtime).

-- Required extensions:
--   pg_trgm  : trigram index for fast label grouping in the "Tri" tab
--   unaccent : accent-insensitive matching for rules
--   pgcrypto : gen_random_uuid() for transfer_group_id generation
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Postgres marks `unaccent` as STABLE by default, which forbids using it in
-- index expressions. Wrap it in an IMMUTABLE SQL function so we can build
-- functional indexes on `immutable_unaccent(lower(...))`.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text
LANGUAGE SQL
IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE category_kind      AS ENUM ('expense', 'income', 'transfer', 'neutral');
CREATE TYPE sign_constraint    AS ENUM ('positive', 'negative', 'any');
CREATE TYPE match_mode         AS ENUM ('word', 'substring', 'regex');
CREATE TYPE category_source    AS ENUM ('manual', 'auto', 'default', 'llm');
CREATE TYPE transfer_direction AS ENUM ('outgoing', 'incoming');
CREATE TYPE import_format      AS ENUM ('ofx', 'csv');

-- ---------------------------------------------------------------------------
-- users — single-user auth for the self-hosted instance
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id              SERIAL PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- accounts — every balance = opening_balance + SUM(amount WHERE date >= opening_date)
-- ---------------------------------------------------------------------------
CREATE TABLE accounts (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  type              TEXT NOT NULL,
  currency          VARCHAR(3) NOT NULL DEFAULT 'EUR',
  opening_balance   NUMERIC(14,2) NOT NULL DEFAULT 0,
  opening_date      DATE NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE account_filename_patterns (
  id           SERIAL PRIMARY KEY,
  pattern      TEXT NOT NULL,
  account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  priority     INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- categories — `kind` powers the sign guard.
-- A default "Divers" row is the fallback for unmatched transactions.
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  kind         category_kind NOT NULL,
  color        VARCHAR(9),
  parent_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  is_default   BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO categories (name, kind, is_default) VALUES ('Divers', 'neutral', TRUE);

-- ---------------------------------------------------------------------------
-- rules — rule engine. The functional index makes accent/case-insensitive
-- matching cheap; `sign_constraint` enforces income-vs-expense semantics.
-- ---------------------------------------------------------------------------
CREATE TABLE rules (
  id                SERIAL PRIMARY KEY,
  category_id       INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  keyword           TEXT NOT NULL,
  sign_constraint   sign_constraint NOT NULL DEFAULT 'any',
  match_mode        match_mode NOT NULL DEFAULT 'word',
  priority          INTEGER NOT NULL DEFAULT 0,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX rules_priority_idx   ON rules (priority DESC);
CREATE INDEX rules_keyword_norm_idx ON rules (immutable_unaccent(lower(keyword)));

-- ---------------------------------------------------------------------------
-- transfer_rules — separate semantics from `rules`. Annotates transactions
-- as legs of internal transfers and links them via `transfer_group_id`.
-- ---------------------------------------------------------------------------
CREATE TABLE transfer_rules (
  id                       SERIAL PRIMARY KEY,
  keyword                  TEXT NOT NULL,
  direction                transfer_direction NOT NULL,
  counterpart_account_id   INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  enabled                  BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------------------
-- file_imports — audit per uploaded file
-- ---------------------------------------------------------------------------
CREATE TABLE file_imports (
  id                SERIAL PRIMARY KEY,
  filename          TEXT NOT NULL,
  account_id        INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  format            import_format NOT NULL,
  imported_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_lines       INTEGER NOT NULL,
  inserted_count    INTEGER NOT NULL,
  dedup_skipped     INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- transactions — one row per leg. Internal transfers = two rows linked by
-- `transfer_group_id`. Dedup at DB level via UNIQUE(account_id, dedup_key).
-- ---------------------------------------------------------------------------
CREATE TABLE transactions (
  id                  BIGSERIAL PRIMARY KEY,
  account_id          INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  date                DATE NOT NULL,
  amount              NUMERIC(14,2) NOT NULL,
  raw_label           TEXT NOT NULL,
  normalized_label    TEXT NOT NULL,
  memo                TEXT,
  fitid               TEXT,
  dedup_key           TEXT NOT NULL,
  category_id         INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  category_source     category_source NOT NULL DEFAULT 'auto',
  transfer_group_id   UUID,
  source_file_id      INTEGER REFERENCES file_imports(id) ON DELETE SET NULL,
  imported_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX transactions_account_dedup_uq
  ON transactions(account_id, dedup_key);

CREATE INDEX transactions_account_date_idx
  ON transactions(account_id, date DESC);

CREATE INDEX transactions_transfer_group_idx
  ON transactions(transfer_group_id);

CREATE INDEX transactions_category_idx
  ON transactions(category_id);

-- Functional index for accent/case-insensitive lookups on labels
CREATE INDEX transactions_normalized_label_norm_idx
  ON transactions (immutable_unaccent(lower(normalized_label)));

-- Trigram index for the "Tri des catégories" grouping (similarity search)
CREATE INDEX transactions_normalized_label_trgm_idx
  ON transactions USING gin (normalized_label gin_trgm_ops);
