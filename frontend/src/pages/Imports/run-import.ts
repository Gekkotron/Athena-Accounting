import { apiUpload } from '../../api/client';
import { submitPdf, type PdfImportNeedsTemplate } from '../../api/pdf-templates';

export type RunOneResult =
  | { ok: true; inserted: number; skipped: number }
  | { ok: false; needsTemplate: PdfImportNeedsTemplate }
  | { ok: false; message: string };

// Runs a single file through the correct import endpoint. Used by the batch
// loop and by the retry-failed flow — both need the same PDF-vs-OFX/CSV
// dispatch, so it lives here in one place.
export async function runOne(file: File, accountId: number | ''): Promise<RunOneResult> {
  try {
    if (file.name.toLowerCase().endsWith('.pdf')) {
      if (accountId === '') return { ok: false, message: 'Compte requis pour un PDF.' };
      const r = await submitPdf(file, accountId as number);
      if (r.kind === 'imported') {
        return { ok: true, inserted: r.result.insertedCount, skipped: r.result.dedupSkipped };
      }
      return { ok: false, needsTemplate: r };
    }
    const data = await apiUpload<{
      filename: string; insertedCount: number; dedupSkipped: number; totalLines: number;
    }>('/api/imports', file, { query: accountId ? { accountId } : undefined });
    return { ok: true, inserted: data.insertedCount, skipped: data.dedupSkipped };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
