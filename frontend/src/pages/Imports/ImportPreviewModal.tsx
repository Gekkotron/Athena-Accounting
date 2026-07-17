import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImportPreview, ImportPreviewRow } from '../../api/imports';

const COLLAPSE_LIMIT = 100;

type Tagged = ImportPreviewRow & { status: 'new' | 'duplicate' };

function formatAmount(amount: string, locale: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ImportPreviewModal({
  preview,
  onConfirm,
  onCancel,
  pending,
}: {
  preview: ImportPreview;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
}): JSX.Element {
  const { t, i18n } = useTranslation(['imports', 'common']);
  const locale = i18n.language.startsWith('en') ? 'en-US' : 'fr-FR';
  const [expanded, setExpanded] = useState(false);

  const rows: Tagged[] = useMemo(() => {
    const n: Tagged[] = preview.newRows.map((r) => ({ ...r, status: 'new' as const }));
    const d: Tagged[] = preview.duplicateRows.map((r) => ({ ...r, status: 'duplicate' as const }));
    return [...n, ...d];
  }, [preview.newRows, preview.duplicateRows]);

  const shown = expanded ? rows : rows.slice(0, COLLAPSE_LIMIT);
  const hidden = rows.length - shown.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('previewModal.ariaLabel', { ns: 'imports' })}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="surface w-full max-w-3xl max-h-[90vh] flex flex-col p-5 md:p-6">
        <div className="mb-4">
          <div className="font-mono text-sm text-ink-100 truncate">{preview.filename}</div>
          <div className="mt-2 text-sm text-ink-300">
            <span className="font-mono text-sage-300">
              {t('previewModal.newCount', { ns: 'imports', count: preview.newRows.length })}
            </span>
            {' · '}
            <span className="font-mono text-ink-400">
              {t('previewModal.duplicateCount', { ns: 'imports', count: preview.duplicateRows.length })}
            </span>
            {' '}
            <span className="text-ink-500">{t('previewModal.ofTotal', { ns: 'imports', count: preview.totalRows })}</span>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto border border-ink-800/60 rounded-lg">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-ink-500 bg-ink-900/50 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2">{t('previewModal.table.date', { ns: 'imports' })}</th>
                <th className="text-left px-3 py-2">{t('previewModal.table.label', { ns: 'imports' })}</th>
                <th className="text-right px-3 py-2">{t('previewModal.table.amount', { ns: 'imports' })}</th>
                <th className="text-left px-3 py-2">{t('previewModal.table.status', { ns: 'imports' })}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr
                  key={`${r.date}-${r.rawLabel}-${i}`}
                  className={r.status === 'duplicate' ? 'text-ink-500' : 'text-ink-200'}
                >
                  <td className="px-3 py-1.5 font-mono">{r.date}</td>
                  <td className="px-3 py-1.5">{r.rawLabel}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{formatAmount(r.amount, locale)}</td>
                  <td className="px-3 py-1.5">
                    <span className={r.status === 'new' ? 'text-sage-300' : 'text-ink-500'}>
                      {r.status === 'new'
                        ? t('previewModal.status.new', { ns: 'imports' })
                        : t('previewModal.status.duplicate', { ns: 'imports' })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-2 text-[11px] text-ink-500 hover:text-ink-100 transition self-start"
          >
            {t('previewModal.showAll', { ns: 'imports', count: hidden })}
          </button>
        )}

        <div className="mt-4 flex items-center justify-end gap-3">
          <button
            type="button"
            className="text-sm text-ink-400 hover:text-ink-100 transition disabled:opacity-40"
            onClick={onCancel}
            disabled={pending}
          >
            {t('cancel', { ns: 'common' })}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? t('previewModal.confirming', { ns: 'imports' }) : t('previewModal.confirm', { ns: 'imports' })}
          </button>
        </div>
      </div>
    </div>
  );
}
