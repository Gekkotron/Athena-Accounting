import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImportPreview, ImportPreviewFuzzyMatch, ImportPreviewRow } from '../../api/imports';

const COLLAPSE_LIMIT = 100;

type Tagged =
  | (ImportPreviewRow & { status: 'new' })
  | (ImportPreviewRow & { status: 'duplicate' })
  | (ImportPreviewRow & {
      status: 'fuzzy-duplicate';
      parsedIndex: number;
      matches: ImportPreviewFuzzyMatch[];
    });

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
  onConfirm: (skipParsedIndices: number[]) => void;
  onCancel: () => void;
  pending?: boolean;
}): JSX.Element {
  const { t, i18n } = useTranslation(['imports', 'common']);
  const locale = i18n.language.startsWith('en') ? 'en-US' : 'fr-FR';
  const [expanded, setExpanded] = useState(false);
  const [tickedSkips, setTickedSkips] = useState<Set<number>>(
    () => new Set(preview.fuzzyDuplicateRows.map((r) => r.parsedIndex)),
  );
  const [openMatchFor, setOpenMatchFor] = useState<number | null>(null);

  const toggleSkip = (idx: number) => {
    setTickedSkips((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const rows: Tagged[] = useMemo(() => {
    const n: Tagged[] = preview.newRows.map((r) => ({ ...r, status: 'new' as const }));
    const d: Tagged[] = preview.duplicateRows.map((r) => ({ ...r, status: 'duplicate' as const }));
    const f: Tagged[] = preview.fuzzyDuplicateRows.map((r) => ({
      ...r.row,
      status: 'fuzzy-duplicate' as const,
      parsedIndex: r.parsedIndex,
      matches: r.matches,
    }));
    return [...n, ...d, ...f].sort((a, b) => a.date.localeCompare(b.date));
  }, [preview.newRows, preview.duplicateRows, preview.fuzzyDuplicateRows]);

  const shown = expanded ? rows : rows.slice(0, COLLAPSE_LIMIT);
  const hidden = rows.length - shown.length;
  const hasFuzzy = preview.fuzzyDuplicateRows.length > 0;

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
            {hasFuzzy && (
              <>
                {' · '}
                <span className="font-mono text-amber-300">
                  {t('previewModal.fuzzyCount', { ns: 'imports', count: preview.fuzzyDuplicateRows.length })}
                </span>
              </>
            )}
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
                {hasFuzzy && (
                  <th className="text-center px-3 py-2">{t('previewModal.fuzzySkipHeader', { ns: 'imports' })}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <PreviewRowLine
                  key={`${r.date}-${r.rawLabel}-${i}`}
                  row={r}
                  locale={locale}
                  hasFuzzyColumn={hasFuzzy}
                  isMatchOpen={r.status === 'fuzzy-duplicate' && openMatchFor === r.parsedIndex}
                  onToggleMatch={
                    r.status === 'fuzzy-duplicate'
                      ? () => setOpenMatchFor(openMatchFor === r.parsedIndex ? null : r.parsedIndex)
                      : undefined
                  }
                  tickedSkips={tickedSkips}
                  toggleSkip={toggleSkip}
                  t={t}
                />
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
            onClick={() => onConfirm(Array.from(tickedSkips))}
            disabled={pending}
          >
            {pending ? t('previewModal.confirming', { ns: 'imports' }) : t('previewModal.confirm', { ns: 'imports' })}
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewRowLine({
  row,
  locale,
  hasFuzzyColumn,
  isMatchOpen,
  onToggleMatch,
  tickedSkips,
  toggleSkip,
  t,
}: {
  row: Tagged;
  locale: string;
  hasFuzzyColumn: boolean;
  isMatchOpen: boolean;
  onToggleMatch?: () => void;
  tickedSkips: Set<number>;
  toggleSkip: (idx: number) => void;
  t: (k: string, o?: Record<string, unknown>) => string;
}): JSX.Element {
  const rowClass =
    row.status === 'duplicate'
      ? 'text-ink-500'
      : row.status === 'fuzzy-duplicate'
        ? 'text-amber-100'
        : 'text-ink-200';

  const statusText =
    row.status === 'new'
      ? t('previewModal.status.new', { ns: 'imports' })
      : row.status === 'duplicate'
        ? t('previewModal.status.duplicate', { ns: 'imports' })
        : t('previewModal.status.fuzzyDuplicate', { ns: 'imports' });

  const statusClass =
    row.status === 'new'
      ? 'text-sage-300'
      : row.status === 'fuzzy-duplicate'
        ? 'text-amber-300'
        : 'text-ink-500';

  return (
    <>
      <tr className={rowClass}>
        <td className="px-3 py-1.5 font-mono">{row.date}</td>
        <td className="px-3 py-1.5">
          {row.status === 'fuzzy-duplicate' && onToggleMatch ? (
            <button
              type="button"
              onClick={onToggleMatch}
              className="text-left hover:text-amber-200 transition"
              aria-expanded={isMatchOpen}
            >
              <span className="mr-1 text-ink-500">{isMatchOpen ? '▾' : '▸'}</span>
              {row.rawLabel}
            </button>
          ) : (
            row.rawLabel
          )}
        </td>
        <td className="px-3 py-1.5 text-right font-mono">{formatAmount(row.amount, locale)}</td>
        <td className="px-3 py-1.5">
          <span className={statusClass}>{statusText}</span>
        </td>
        {hasFuzzyColumn && (
          <td className="px-3 py-1.5 text-center">
            {row.status === 'fuzzy-duplicate' ? (
              <input
                type="checkbox"
                checked={tickedSkips.has(row.parsedIndex)}
                onChange={() => toggleSkip(row.parsedIndex)}
                aria-label={t('previewModal.fuzzySkipHeader', { ns: 'imports' })}
              />
            ) : null}
          </td>
        )}
      </tr>
      {row.status === 'fuzzy-duplicate' && isMatchOpen && row.matches.length > 0 && (
        <tr className="text-[11px] text-ink-400 bg-ink-900/30">
          <td colSpan={hasFuzzyColumn ? 5 : 4} className="px-3 py-1.5">
            <span className="text-ink-500">{t('previewModal.fuzzyMatchLabel', { ns: 'imports' })}</span>
            {' '}
            <span className="font-mono">{row.matches[0]!.date}</span>
            {' · '}
            <span>{row.matches[0]!.rawLabel}</span>
            {' · '}
            <span className="font-mono">{formatAmount(row.matches[0]!.amount, locale)}</span>
            {row.matches.length > 1 && (
              <span className="ml-2 text-ink-500">+{row.matches.length - 1}</span>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
