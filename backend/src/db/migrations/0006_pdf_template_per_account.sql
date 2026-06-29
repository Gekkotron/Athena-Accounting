-- A single bank PDF often contains multiple accounts (compte courant + livret,
-- multiple cards, etc.). The template needs to be account-bound so a PDF with
-- N accounts produces N templates — one per (fingerprint, account_id) pair —
-- and a re-upload picks the right one based on which account the user selected
-- at upload time.
--
-- The previous UNIQUE on fingerprint alone allowed only one template per PDF
-- format, so the orchestrator could never auto-apply different page selections
-- for different accounts on the same statement. Drop that constraint and
-- replace it with a composite UNIQUE on (fingerprint, account_id).
--
-- Existing rows: keep them but leave account_id NULL. They become "legacy"
-- templates and won't be picked up by the new lookup path (which requires an
-- accountId match). The user can delete them via /api/pdf-templates and
-- re-create per-account templates as needed.

ALTER TABLE pdf_statement_templates
  ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE pdf_statement_templates
  DROP CONSTRAINT pdf_statement_templates_fingerprint_key;

CREATE UNIQUE INDEX pdf_statement_templates_fingerprint_account_idx
  ON pdf_statement_templates (fingerprint, account_id);
