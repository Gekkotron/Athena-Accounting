import { useTranslation } from 'react-i18next';
import { runOne } from './run-import';
import type { BatchState } from './BatchSummaryPanel';
import type { PdfImportNeedsTemplate } from '../../api/pdf-templates';

// Retry orchestration for a batch's error list. Given the current batch and
// a state setter, exposes retryOne (by index) and retryAll (sequential over
// the current failed set). Success removes the row and folds its counts into
// the totals; failure updates the message in place.
//
// PDF retries that come back as needs_template are handed off to the parent
// via onNeedsTemplate — that opens the wizard, and the returned promise
// resolves when the wizard finalizes (true) or cancels (false).
export function useBatchRetry(opts: {
  batch: BatchState | null;
  setBatch: (updater: (prev: BatchState | null) => BatchState | null) => void;
  accountId: number | '';
  invalidate: () => void;
  onNeedsTemplate: (r: PdfImportNeedsTemplate) => Promise<boolean>;
}) {
  const { t } = useTranslation('imports');
  const applyOutcome = (file: File, outcome:
    | { ok: true; inserted: number; skipped: number }
    | { ok: false; message: string }
  ) => {
    let ok = false;
    opts.setBatch((prev) => {
      if (!prev || prev.phase !== 'done') return prev;
      const idx = prev.errors.findIndex((e) => e.file === file);
      if (idx < 0) return prev;
      const nextErrors = prev.errors.slice();
      if (outcome.ok) {
        ok = true;
        nextErrors.splice(idx, 1);
        return {
          ...prev, errors: nextErrors,
          imported: prev.imported + 1,
          inserted: prev.inserted + outcome.inserted,
          skipped: prev.skipped + outcome.skipped,
        };
      }
      nextErrors[idx] = { file, message: outcome.message };
      return { ...prev, errors: nextErrors };
    });
    if (ok) opts.invalidate();
  };

  const retryFile = async (file: File) => {
    const r = await runOne(file, opts.accountId, t);
    if (r.ok) return applyOutcome(file, r);
    if ('needsTemplate' in r) {
      const success = await opts.onNeedsTemplate(r.needsTemplate);
      applyOutcome(file, success
        ? { ok: true, inserted: 0, skipped: 0 }
        : { ok: false, message: t('errors.templateCancelled') });
      return;
    }
    applyOutcome(file, { ok: false, message: r.message });
  };

  const retryOne = (index: number) => {
    if (!opts.batch || opts.batch.phase !== 'done') return;
    const target = opts.batch.errors[index];
    if (target) void retryFile(target.file);
  };

  const retryAll = async () => {
    if (!opts.batch || opts.batch.phase !== 'done') return;
    const files = opts.batch.errors.map((e) => e.file);
    for (const f of files) await retryFile(f);
  };

  return { retryOne, retryAll };
}
