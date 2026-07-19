import type { TFunction } from 'i18next';
import { apiUpload } from '../../api/client';
import { submitPdf, submitPhoto, type PdfImportNeedsTemplate } from '../../api/pdf-templates';
import { errorMessage } from '../../api/errorMessage';

export type RunOneResult =
  | { ok: true; inserted: number; skipped: number }
  | { ok: false; needsTemplate: PdfImportNeedsTemplate }
  | { ok: false; message: string };

export const isPdfFile = (name: string) => /\.pdf$/i.test(name);
export const isImageFile = (name: string) => /\.(jpe?g|png|webp|heic)$/i.test(name);
export const isOfxCsvFile = (name: string) => /\.(ofx|qfx|csv)$/i.test(name);

// Runs a single file through the correct import endpoint. Used by the batch
// loop and by the retry-failed flow — both need the same dispatch, so it
// lives here in one place.
//
// PDFs try the text-layer path first; when the backend reports no_text_layer
// we re-submit through the OCR endpoint so a scanned PDF still makes it in
// without asking the user to switch inputs.
export async function runOne(file: File, accountId: number | '', t: TFunction): Promise<RunOneResult> {
  try {
    if (isPdfFile(file.name)) {
      if (accountId === '') return { ok: false, message: t('errors.accountRequiredForPdf', { ns: 'imports' }) };
      let r = await submitPdf(file, accountId as number);
      if (r.kind === 'needs_template' && r.reason === 'no_text_layer') {
        r = await submitPhoto(file, accountId as number);
      }
      if (r.kind === 'imported') {
        return { ok: true, inserted: r.result.insertedCount, skipped: r.result.dedupSkipped };
      }
      return { ok: false, needsTemplate: r };
    }
    if (isImageFile(file.name)) {
      if (accountId === '') return { ok: false, message: t('errors.accountRequiredForPdf', { ns: 'imports' }) };
      const r = await submitPhoto(file, accountId as number);
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
    return { ok: false, message: errorMessage(err, t) };
  }
}
