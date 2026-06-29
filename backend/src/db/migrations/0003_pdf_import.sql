-- PDF bank statement import — adds the format enum value plus two tables:
-- pdf_statement_templates (one row per learned bank layout, keyed by content
-- fingerprint) and pdf_import_drafts (a parked upload while the user paints
-- zones in the UI).

ALTER TYPE import_format ADD VALUE IF NOT EXISTS 'pdf';

CREATE TABLE pdf_statement_templates (
  id           SERIAL PRIMARY KEY,
  fingerprint  TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,
  zones        JSONB NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('heuristic', 'interactive')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pdf_import_drafts (
  id           SERIAL PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pdf_bytes    BYTEA NOT NULL,
  text_items   JSONB NOT NULL,
  fingerprint  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours'
);

CREATE INDEX pdf_import_drafts_expires_at_idx ON pdf_import_drafts(expires_at);
