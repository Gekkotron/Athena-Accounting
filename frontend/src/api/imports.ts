import { apiUpload } from './client';

export interface ImportPreviewRow {
  date: string;
  amount: string;
  rawLabel: string;
  memo: string | null;
}

export interface ImportPreview {
  filename: string;
  format: 'ofx' | 'csv';
  accountId: number;
  totalRows: number;
  newRows: ImportPreviewRow[];
  duplicateRows: ImportPreviewRow[];
}

export function previewImport(file: File, accountId?: number): Promise<ImportPreview> {
  return apiUpload<ImportPreview>(
    '/api/imports/preview',
    file,
    { query: accountId !== undefined ? { accountId } : undefined },
  );
}
