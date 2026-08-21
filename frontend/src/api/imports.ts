import { apiUpload } from './client';

export interface ImportPreviewRow {
  date: string;
  amount: string;
  rawLabel: string;
  memo: string | null;
}

export interface ImportPreviewFuzzyMatch {
  txId: number;
  date: string;
  amount: string;
  rawLabel: string;
}

export interface ImportPreviewFuzzyRow {
  row: ImportPreviewRow;
  parsedIndex: number;
  matches: ImportPreviewFuzzyMatch[];
}

export interface ImportPreview {
  filename: string;
  format: 'ofx' | 'csv' | 'camt';
  accountId: number;
  totalRows: number;
  newRows: ImportPreviewRow[];
  duplicateRows: ImportPreviewRow[];
  fuzzyDuplicateRows: ImportPreviewFuzzyRow[];
}

export interface ImportCommitResult {
  filename: string;
  insertedCount: number;
  dedupSkipped: number;
  userSkipped: number;
  totalLines: number;
}

export function previewImport(file: File, accountId?: number): Promise<ImportPreview> {
  return apiUpload<ImportPreview>(
    '/api/imports/preview',
    file,
    { query: accountId !== undefined ? { accountId } : undefined },
  );
}

export function commitImport(
  file: File,
  opts: { accountId?: number; skipParsedIndices: number[] },
): Promise<ImportCommitResult> {
  return apiUpload<ImportCommitResult>(
    '/api/imports',
    file,
    {
      query: opts.accountId !== undefined ? { accountId: opts.accountId } : undefined,
      fields: opts.skipParsedIndices.length
        ? { skipParsedIndices: JSON.stringify(opts.skipParsedIndices) }
        : undefined,
    },
  );
}
