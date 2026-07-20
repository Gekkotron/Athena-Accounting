import { Trans, useTranslation } from 'react-i18next';
import { PreviewTable, type PreviewRow } from './PreviewTable';
import type { PreviewResult } from '../../api/pdf-templates.js';
import { formatAmount, formatDate, amountSignClass } from '../../lib/format';

interface Props {
  canSubmit: boolean;
  previewLoading: boolean;
  previewError: string | null;
  previewRows: PreviewResult['rows'] | null;
  previewSkipped: PreviewResult['skippedRows'];
  isOcrSource: boolean;
  editableRows: PreviewRow[];
  submitting: boolean;
  onPreview: () => void;
  onEditableRowChange: (i: number, patch: Partial<PreviewRow>) => void;
  onEditableRowDelete: (i: number) => void;
  onOcrImport: () => void;
}

export function PreviewSection({
  canSubmit,
  previewLoading,
  previewError,
  previewRows,
  previewSkipped,
  isOcrSource,
  editableRows,
  submitting,
  onPreview,
  onEditableRowChange,
  onEditableRowDelete,
  onOcrImport,
}: Props): JSX.Element {
  const { t } = useTranslation('pdf-template');
  return (
    <div className="mt-6 border-t border-ink-800/60 pt-5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-ink-100">
          {t('preview.heading')}
          {previewRows && (
            <span className="text-ink-500 font-normal font-mono ml-2">
              {t('preview.rowCount', { count: previewRows.length })}
            </span>
          )}
        </div>
        <button
          className="px-3 py-1.5 rounded-lg border border-ink-700 text-ink-200 hover:bg-ink-850 transition text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={onPreview}
          disabled={!canSubmit || previewLoading}
          type="button"
        >
          {previewLoading ? t('preview.buttonLoading') : t('preview.button')}
        </button>
      </div>
      {previewError && (
        <div className="text-clay-300 bg-clay-900/30 border border-clay-800/60 p-2 rounded-md text-xs mb-2">
          {previewError}
        </div>
      )}
      {previewRows === null && !previewLoading && !previewError && (
        <div className="text-xs text-ink-500 display-italic">
          <Trans i18nKey="pdf-template:preview.emptyHint">
            Click <span className="font-medium not-italic text-ink-400">Preview</span> to check before importing.
          </Trans>
        </div>
      )}
      {previewRows && previewRows.length === 0 && (
        <div className="text-xs text-clay-300 display-italic">
          {t('preview.noRows')}
        </div>
      )}
      {previewRows && previewRows.length > 0 && isOcrSource && (
        <PreviewTable
          rows={editableRows}
          editable
          onChange={onEditableRowChange}
          onDelete={onEditableRowDelete}
          onImport={onOcrImport}
          importing={submitting}
        />
      )}
      {previewRows && previewRows.length > 0 && !isOcrSource && (
        <div className="max-h-72 overflow-y-auto pr-1">
          <table className="w-full text-xs">
            <thead className="text-left text-ink-500">
              <tr>
                <th className="py-1.5 pr-3 font-normal">{t('columns.date')}</th>
                <th className="py-1.5 pr-3 font-normal">{t('columns.description')}</th>
                <th className="py-1.5 pl-3 font-normal text-right">{t('columns.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((r, i) => (
                <tr key={i} className="border-t border-ink-800/40">
                  <td className="py-1.5 pr-3 font-mono text-ink-300 whitespace-nowrap">{formatDate(r.date)}</td>
                  <td className="py-1.5 pr-3 text-ink-100">
                    <div className="truncate max-w-[26rem]" title={r.rawLabel}>{r.rawLabel}</div>
                  </td>
                  <td className={`py-1.5 pl-3 text-right font-mono tabular-nums whitespace-nowrap ${amountSignClass(r.amount)}`}>
                    {formatAmount(r.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {previewSkipped.length > 0 && (
        <details className="mt-3 text-xs text-ink-500">
          <summary className="cursor-pointer">{t('preview.skippedSummary', { count: previewSkipped.length })}</summary>
          <ul className="mt-2 space-y-1 font-mono">
            {previewSkipped.map((s, i) => (
              <li key={i}><code>{s.rowText}</code> — {s.reason}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
