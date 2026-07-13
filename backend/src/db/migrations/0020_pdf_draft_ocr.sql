-- OCR support for pdf_import_drafts:
--   source_kind — 'pdf' (default) or 'photo' (added in Task 4). All existing
--                 drafts are PDFs; safe to backfill via default.
--   ocr_status  — 'not_needed' (default, existing text-PDF flow) | 'pending'
--                 (upload set this before returning; a background job flips
--                 it to 'ready' or 'error') | 'ready' | 'error'.
--   ocr_progress / ocr_total — pages OCR'd / total pages to OCR. Both 0 for
--                 not_needed drafts; ocr_total set at upload time for pending.
--   ocr_error   — human-readable message when ocr_status = 'error'.
ALTER TABLE pdf_import_drafts
  ADD COLUMN source_kind  text NOT NULL DEFAULT 'pdf',
  ADD COLUMN ocr_status   text NOT NULL DEFAULT 'not_needed',
  ADD COLUMN ocr_progress integer NOT NULL DEFAULT 0,
  ADD COLUMN ocr_total    integer NOT NULL DEFAULT 0,
  ADD COLUMN ocr_error    text;
