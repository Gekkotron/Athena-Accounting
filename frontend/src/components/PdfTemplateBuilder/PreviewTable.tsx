import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export interface PreviewRow {
  date: string;
  label: string;
  amount: string;
  confidence?: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_RE = /^-?\d+([.,]\d{1,2})?$/;

function severity(confidence: number): 'high' | 'mid' | 'low' {
  if (confidence >= 0.85) return 'high';
  if (confidence >= 0.65) return 'mid';
  return 'low';
}

function severityClass(sev: 'high' | 'mid' | 'low'): string {
  switch (sev) {
    case 'high': return 'bg-sage-400';
    case 'mid':  return 'bg-amber-400';
    case 'low':  return 'bg-clay-400';
  }
}

export function PreviewTable({
  rows, editable, onChange, onDelete, onImport, importing,
}: {
  rows: PreviewRow[];
  editable: boolean;
  onChange?: (index: number, patch: Partial<PreviewRow>) => void;
  onDelete?: (index: number) => void;
  onImport: () => void;
  importing: boolean;
}): JSX.Element {
  const { t } = useTranslation('pdf-template');
  const hasConfidence = useMemo(() => rows.some((r) => r.confidence != null), [rows]);
  const invalid = useMemo(() => rows.some((r) =>
    editable && (!DATE_RE.test(r.date) || !AMOUNT_RE.test(r.amount))
  ), [rows, editable]);

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm text-ink-400">{t('previewTable.summary', { count: rows.length })}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-ink-500">
            <tr>
              <th className="pb-2 pr-3">{t('columns.date')}</th>
              <th className="pb-2 pr-3">{t('columns.description')}</th>
              <th className="pb-2 pr-3 text-right">{t('columns.amount')}</th>
              {hasConfidence && <th className="pb-2 pr-3">{t('columns.confidence')}</th>}
              {editable && <th className="pb-2"></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const dateOk = DATE_RE.test(r.date);
              const amountOk = AMOUNT_RE.test(r.amount);
              return (
                <tr key={i} className="border-t border-ink-800/40">
                  <td className="py-1.5 pr-3">
                    {editable ? (
                      <input
                        aria-label={t('columns.date')}
                        className={`input-sm ${!dateOk ? 'border-clay-500' : ''}`}
                        data-invalid={!dateOk}
                        value={r.date}
                        onChange={(e) => onChange?.(i, { date: e.target.value })}
                      />
                    ) : <span>{r.date}</span>}
                  </td>
                  <td className="py-1.5 pr-3">
                    {editable ? (
                      <input
                        aria-label={t('columns.description')}
                        className="input-sm w-full"
                        value={r.label}
                        onChange={(e) => onChange?.(i, { label: e.target.value })}
                      />
                    ) : <span>{r.label}</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono">
                    {editable ? (
                      <input
                        aria-label={t('columns.amount')}
                        className={`input-sm text-right ${!amountOk ? 'border-clay-500' : ''}`}
                        data-invalid={!amountOk}
                        value={r.amount}
                        onChange={(e) => onChange?.(i, { amount: e.target.value })}
                      />
                    ) : <span>{r.amount}</span>}
                  </td>
                  {hasConfidence && (
                    <td className="py-1.5 pr-3">
                      {r.confidence != null && (
                        <span
                          data-testid="confidence-dot"
                          data-severity={severity(r.confidence)}
                          className={`inline-block h-2 w-2 rounded-full ${severityClass(severity(r.confidence))}`}
                          title={`${Math.round(r.confidence * 100)}%`}
                        />
                      )}
                    </td>
                  )}
                  {editable && (
                    <td className="py-1.5">
                      <button
                        type="button"
                        aria-label={t('previewTable.deleteRow')}
                        className="text-ink-500 hover:text-clay-300"
                        onClick={() => onDelete?.(i)}
                      >×</button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          className="btn-primary"
          disabled={invalid || importing || rows.length === 0}
          onClick={onImport}
        >
          {importing ? t('previewTable.importButtonLoading') : t('previewTable.importButton')}
        </button>
      </div>
    </div>
  );
}
