import type { PdfImportNeedsTemplate, PdfImportImported } from '../../api/pdf-templates';
import { PdfTemplateBuilder } from '../../components/PdfTemplateBuilder/index';

export function PdfTemplateWizard({
  needsTpl,
  lastImported,
  pdfError,
  onFinalize,
  onCancel,
}: {
  needsTpl: PdfImportNeedsTemplate | null;
  lastImported: PdfImportImported | null;
  pdfError: string | null;
  accountId: number | '';
  onFinalize: (result: PdfImportImported) => void;
  onCancel: () => void;
}) {
  if (!needsTpl && !lastImported && !pdfError) return null;

  return (
    <>
      {pdfError && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-4 py-3 text-sm text-clay-200">
          {pdfError}
        </div>
      )}

      {lastImported && (
        <div className="surface p-5">
          <div className="label mb-2">Dernier import PDF</div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="display text-2xl text-ink-100">{lastImported.result.totalLines}</span>
              <span className="text-ink-500 ml-2">lue{lastImported.result.totalLines !== 1 ? 's' : ''}</span>
            </div>
            <div>
              <span className="display text-2xl text-sage-300">{lastImported.result.insertedCount}</span>
              <span className="text-ink-500 ml-2">insérée{lastImported.result.insertedCount !== 1 ? 's' : ''}</span>
            </div>
            <div>
              <span className="display text-2xl text-ink-400">{lastImported.result.dedupSkipped}</span>
              <span className="text-ink-500 ml-2">dédupliquée{lastImported.result.dedupSkipped !== 1 ? 's' : ''}</span>
            </div>
          </div>
          {lastImported.skippedRows.length > 0 && (
            <details className="mt-3 text-sm text-ink-400">
              <summary className="cursor-pointer">{lastImported.skippedRows.length} ligne(s) ignorée(s)</summary>
              <ul className="mt-2 space-y-1 font-mono text-xs">
                {lastImported.skippedRows.map((s, i) => (
                  <li key={i}><code>{s.rowText}</code> — {s.reason}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {needsTpl && (
        <PdfTemplateBuilder
          needsTemplate={needsTpl}
          onClose={onCancel}
          onImported={onFinalize}
        />
      )}
    </>
  );
}
