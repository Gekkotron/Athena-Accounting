// Shared types for the import pipeline. Kept in a small module so the
// split submodules (run-import-transaction, post-commit-fan-out) don't
// have to circularly import from import-service.ts.

export type ImportFormat = 'ofx' | 'csv' | 'pdf' | 'bank-sync' | 'camt';

export interface ImportResult {
  fileImportId: number;
  format: ImportFormat;
  accountId: number;
  totalLines: number;
  insertedCount: number;
  dedupSkipped: number;
  userSkipped: number;
  insertedIds: number[];
  // Rows the parser produced but the DB dedup-skipped (a matching
  // (account_id, dedup_key) already existed). Surfaced in the import
  // summary so the user can see WHAT was skipped, not just how many.
  dedupSkippedRows: Array<{ date: string; amount: string; rawLabel: string }>;
}
