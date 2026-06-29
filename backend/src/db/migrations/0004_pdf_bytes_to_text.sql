-- pdf_import_drafts.pdf_bytes was declared as BYTEA in 0003 but the application
-- stores the upload as a base64 string (Drizzle has no bytea helper exposed at
-- our version, so the column is declared as text() in the schema). When a text
-- parameter is bound into a bytea column, Postgres applies its implicit escape
-- cast and stores the raw ASCII bytes of the base64 characters — so when we
-- SELECT, the pg driver returns a Buffer of those ASCII bytes, and Buffer.from
-- (buffer, 'base64') silently ignores the 'base64' argument and copies the
-- buffer as-is. pdfjs then sees the bytes of a base64 string instead of a PDF
-- and throws "Invalid PDF structure" on applyTemplateAndImport.
--
-- Aligning the column type with how the app uses it (plain TEXT holding
-- base64) removes the ambiguity. Drafts are 24h-lived so truncating any
-- in-flight rows before the ALTER is the cleanest path.

TRUNCATE pdf_import_drafts;

ALTER TABLE pdf_import_drafts
  ALTER COLUMN pdf_bytes TYPE TEXT;
