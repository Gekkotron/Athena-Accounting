import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { PdfImportNeedsTemplate, PdfImportImported } from '../../api/pdf-templates';
import type { Transaction } from '../../api/types';
import { formatAmount, formatDate, amountSignClass } from '../../lib/format';
import { PdfTemplateBuilder } from '../../components/PdfTemplateBuilder/index';

export function PdfTemplateWizard({
  needsTpl,
  lastImported,
  onFinalize,
  onCancel,
}: {
  needsTpl: PdfImportNeedsTemplate | null;
  lastImported: PdfImportImported | null;
  accountId: number | '';
  onFinalize: (result: PdfImportImported) => void;
  onCancel: () => void;
}): JSX.Element | null {
  if (!needsTpl && !lastImported) return null;

  return (
    <>
      {lastImported && (
        <ImportSummary lastImported={lastImported} />
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

function ImportSummary({ lastImported }: { lastImported: PdfImportImported }) {
  const sourceFileId = lastImported.result.fileImportId;

  // Pull every transaction inserted from this specific file_import row so the
  // user has an immediate visual of what landed. Limit = 500 is well above
  // any realistic single-statement page count and matches the backend cap.
  const txQ = useQuery({
    queryKey: ['transactions', { sourceFileId }],
    queryFn: () =>
      api<{
        transactions: Transaction[];
        pagination: { total: number; limit: number; offset: number };
      }>('/api/transactions', {
        query: { sourceFileId, includeTransfers: true, limit: 500 },
      }),
    enabled: sourceFileId > 0,
  });

  const rows = txQ.data?.transactions ?? [];

  return (
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

      <div className="mt-4 pt-4 border-t border-ink-800/60">
        <div className="text-sm text-ink-100 font-medium mb-2">
          Transactions importées{' '}
          <span className="text-ink-500 font-normal font-mono">
            ({rows.length})
          </span>
        </div>
        {txQ.isLoading ? (
          <div className="text-xs text-ink-500 display-italic">Chargement…</div>
        ) : rows.length === 0 ? (
          <div className="text-xs text-ink-500 display-italic">
            Aucune transaction associée à ce fichier — soit c'était un doublon complet, soit toutes les lignes ont été ignorées.
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto pr-1">
            <table className="w-full text-xs">
              <thead className="text-left text-ink-500">
                <tr>
                  <th className="py-1.5 pr-3 font-normal">Date</th>
                  <th className="py-1.5 pr-3 font-normal">Libellé</th>
                  <th className="py-1.5 pl-3 font-normal text-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-t border-ink-800/40">
                    <td className="py-1.5 pr-3 font-mono text-ink-300 whitespace-nowrap">
                      {formatDate(t.date)}
                    </td>
                    <td className="py-1.5 pr-3 text-ink-100">
                      <div className="truncate max-w-[26rem]" title={t.rawLabel}>{t.rawLabel}</div>
                    </td>
                    <td className={`py-1.5 pl-3 text-right font-mono tabular-nums whitespace-nowrap ${amountSignClass(t.amount)}`}>
                      {formatAmount(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
