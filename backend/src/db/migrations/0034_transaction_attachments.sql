-- Persistent attachments (receipts, invoices, contracts…) tied to a
-- transaction. Files are stored on the local volume under
-- DATA_DIR/attachments/<user_id>/<attachment_id>.bin — bytes are NEVER
-- persisted in Postgres so pg_dump stays cheap and the PGlite bundle in the
-- desktop app doesn't balloon with every upload. This differs from the
-- transient bytea storage used by pdf_import_drafts (photos), which is a
-- short-lived draft consumed then deleted.
--
-- `stored_path` holds the on-disk path relative to DATA_DIR/attachments/,
-- so a future storage rework (e.g. hashed object store, S3-style backend)
-- can migrate the format without a schema change.
--
-- Backup format v4 does NOT include attachments — see
-- backend/src/http/routes/backup/schema.ts for the rationale.
CREATE TABLE transaction_attachments (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transaction_id  BIGINT  NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  filename        TEXT    NOT NULL,
  mime            TEXT    NOT NULL,
  size_bytes      INTEGER NOT NULL,
  stored_path     TEXT    NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX transaction_attachments_transaction_idx
  ON transaction_attachments (transaction_id);
CREATE INDEX transaction_attachments_user_idx
  ON transaction_attachments (user_id);
