import { forwardRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Account, Category, Transaction, BalanceCheckpoint } from '../../api/types';
import { formatAmount, formatDate, amountSignClass } from '../../lib/format';
import { formatCategoryPath } from '../../lib/categories';

export type TransactionRowProps = {
  tx: Transaction;
  account: Account | undefined;
  categories: Category[];
  selected: boolean;
  onToggleSelect: (id: number, checked: boolean) => void;
  onUpdateCategory: (id: number, patch: { categoryId: number | null }) => void;
  onUpdateNotes: (id: number, patch: { notes: string | null }) => void;
  onEdit: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
  expanded: boolean;
  onToggleExpanded: (id: number) => void;
  showBalance: boolean;
  isEndOfDay: boolean;
  checkpoint: BalanceCheckpoint | undefined;
  checkpointPending: boolean;
  onToggleCheckpoint: (tx: Transaction, checked: boolean) => void;
};

export const TransactionRow = forwardRef<HTMLTableRowElement, TransactionRowProps>(
  function TransactionRow(
    {
      tx,
      account,
      categories,
      selected,
      onToggleSelect,
      onUpdateCategory,
      onUpdateNotes,
      onEdit,
      onDelete,
      expanded,
      onToggleExpanded,
      showBalance,
      isEndOfDay,
      checkpoint,
      checkpointPending,
      onToggleCheckpoint,
    },
    ref,
  ) {
  const { t } = useTranslation(['transactions', 'common']);
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  return (
    <>
      <tr ref={ref} className={`group border-b border-ink-800/40 last:border-0 hover:bg-ink-850/40 transition ${selected ? 'bg-sage-900/10' : ''}`}>
        <td className="px-2 py-2.5 text-center">
          <input
            type="checkbox"
            className="align-middle accent-sage-300"
            checked={selected}
            onChange={(e) => onToggleSelect(tx.id, e.target.checked)}
            aria-label={t('row.selectAriaLabel', { label: tx.rawLabel })}
          />
        </td>
        <td className="px-4 py-2.5 text-ink-300 whitespace-nowrap font-mono text-xs">{formatDate(tx.date)}</td>
        <td className="px-4 py-2.5 text-ink-400 whitespace-nowrap hidden sm:table-cell">{account?.name ?? '?'}</td>
        <td className="px-4 py-2.5 text-ink-100">
          <div className="truncate max-w-[18rem] md:max-w-md" title={tx.rawLabel}>
            {tx.rawLabel}
          </div>
          {tx.transferGroupId && (
            <div className="text-[11px] text-amber-300/80 mt-0.5 flex items-center gap-1">
              <span aria-hidden>↹</span> {t('row.internalTransferBadge')}
            </div>
          )}
          <div className="sm:hidden text-[11px] text-ink-500 mt-0.5">{account?.name}</div>
        </td>
        <td className="px-4 py-2.5">
          {tx.splits.length > 0 ? (
            <button
              type="button"
              className="btn-ghost !py-1 !px-2 text-xs text-sage-200"
              onClick={() => onToggleExpanded(tx.id)}
              aria-expanded={expanded}
            >
              {expanded ? '▾' : '▸'} {t('row.splitBadge', { count: tx.splits.length })}
            </button>
          ) : (
            <>
              <select
                className="input-sm"
                value={tx.categoryId ?? ''}
                disabled={!!tx.transferGroupId}
                onChange={(e) =>
                  onUpdateCategory(tx.id, {
                    categoryId: e.target.value ? Number(e.target.value) : null,
                  })
                }
              >
                <option value="">—</option>
                {[...categories]
                  .sort((a, b) => {
                    const pa = a.parentId != null ? catById.get(a.parentId)?.name ?? '' : a.name;
                    const pb = b.parentId != null ? catById.get(b.parentId)?.name ?? '' : b.name;
                    return pa.localeCompare(pb) || a.name.localeCompare(b.name);
                  })
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {formatCategoryPath(c, catById)}
                    </option>
                  ))}
              </select>
              {tx.categorySource === 'manual' && <div className="text-[10px] text-ink-500 mt-1">{t('row.manualTag')}</div>}
            </>
          )}
        </td>
        <td className="px-4 py-2.5 hidden md:table-cell">
          <input
            defaultValue={tx.notes ?? ''}
            key={`notes-${tx.id}-${tx.notes ?? ''}`}
            placeholder="…"
            className="input-sm w-40 placeholder:text-ink-700"
            onBlur={(e) => {
              const v = e.target.value;
              const current = tx.notes ?? '';
              if (v !== current) {
                onUpdateNotes(tx.id, { notes: v || null });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') (e.target as HTMLInputElement).value = tx.notes ?? '';
            }}
          />
        </td>
        <td className={`px-4 py-2.5 text-right font-mono whitespace-nowrap tabular-nums ${amountSignClass(tx.amount)}`}>
          {formatAmount(tx.amount, account?.currency ?? 'EUR')}
        </td>
        {showBalance && (
          <td className="px-4 py-2.5 text-right font-mono whitespace-nowrap tabular-nums text-ink-300">
            <span className="inline-flex items-center justify-end gap-2">
              {isEndOfDay && tx.runningBalance != null && (
                <input
                  type="checkbox"
                  className="align-middle accent-sage-300"
                  checked={checkpoint != null}
                  disabled={checkpointPending}
                  onChange={(e) => onToggleCheckpoint(tx, e.target.checked)}
                  aria-label={t('row.checkpointAriaLabel', { date: formatDate(tx.date) })}
                  title={t('row.checkpointTitle')}
                />
              )}
              <span>{tx.runningBalance != null ? formatAmount(tx.runningBalance, account?.currency ?? 'EUR') : '—'}</span>
            </span>
          </td>
        )}
        <td className="px-3 py-2.5 text-right whitespace-nowrap">
          <div className="inline-flex gap-0.5">
            <button
              onClick={() => onEdit(tx)}
              className="p-1.5 rounded text-ink-600 hover:text-ink-100 hover:bg-ink-900 transition"
              title={t('edit', { ns: 'common' })}
              aria-label={t('edit', { ns: 'common' })}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M2 10l6-6 2 2-6 6L2 12V10z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              onClick={() => onDelete(tx)}
              className="p-1.5 rounded text-ink-600 hover:text-clay-300 hover:bg-ink-900 transition"
              title={t('delete', { ns: 'common' })}
              aria-label={t('delete', { ns: 'common' })}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M3 4h8M5.5 4V2.5h3V4M4 4l0.7 8h4.6L10 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </td>
      </tr>
      {expanded &&
        tx.splits.length > 0 &&
        tx.splits.map((s) => {
          const cat = s.categoryId ? catById.get(s.categoryId) : null;
          return (
            <tr key={`split-${s.id}`} className="border-b border-ink-900/30 bg-ink-900/20">
              <td />
              <td />
              <td className="hidden sm:table-cell" />
              <td className="px-4 py-1.5 pl-8 text-ink-300 text-xs">
                ⤷ {cat ? formatCategoryPath(cat, catById) : '—'}
                {s.memo && <span className="text-ink-500 ml-2">· {s.memo}</span>}
              </td>
              <td />
              <td className="hidden md:table-cell" />
              <td className="px-4 py-1.5 text-right font-mono text-xs tabular-nums">
                {s.amount} {account?.currency ?? 'EUR'}
              </td>
              {showBalance && <td />}
              <td />
            </tr>
          );
        })}
    </>
  );
  },
);
