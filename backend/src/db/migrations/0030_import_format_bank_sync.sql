-- The bank-sync engine records one file_imports audit row per sync batch so
-- synced transactions carry the same provenance trail as file imports. New
-- enum value rather than reusing 'ofx' — the imports list should say what
-- actually happened.
ALTER TYPE import_format ADD VALUE 'bank-sync';
