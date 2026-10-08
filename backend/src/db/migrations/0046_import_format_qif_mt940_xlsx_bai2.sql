-- Four new file-import formats land together:
--   qif   — Quicken Interchange Format (legacy but still exported by Quicken,
--           GnuCash, Moneydance). No bank-provided unique id, hash-dedup only.
--   mt940 — SWIFT pre-ISO20022 bank statement. Widely used by European banks
--           alongside CAMT.053. :61: Bank-reference used as fitid when present.
--   xlsx  — Excel workbook (.xlsx/.xls). Many consumer banks only export spreadsheets.
--   bai2  — Bank Administration Institute cash-management format. US corporate standard.
ALTER TYPE import_format ADD VALUE 'qif';
ALTER TYPE import_format ADD VALUE 'mt940';
ALTER TYPE import_format ADD VALUE 'xlsx';
ALTER TYPE import_format ADD VALUE 'bai2';
