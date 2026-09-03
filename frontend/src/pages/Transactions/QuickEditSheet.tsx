import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Account, Category, Transaction } from '../../api/types';
import { formatAmount, formatDate, amountSignClass } from '../../lib/format';
import { formatCategoryPath } from '../../lib/categories';

// Mobile-only quick-edit affordance for a single transaction: notes + category.
// Opens as a bottom sheet from the card list. Full-form editing (label, date,
// account, splits, attachments…) still routes to the desktop TransactionModal
// via the "Advanced edit" action so this sheet stays a light-touch flow.
export function QuickEditSheet({
  tx,
  account,
  sortedCategories,
  catById,
  onClose,
  onUpdateNotes,
  onUpdateCategory,
  onAdvancedEdit,
  onDelete,
}: {
  tx: Transaction | null;
  account: Account | undefined;
  sortedCategories: Category[];
  catById: Map<number, Category>;
  onClose: () => void;
  onUpdateNotes: (id: number, patch: { notes: string | null }) => void;
  onUpdateCategory: (id: number, patch: { categoryId: number | null }) => void;
  onAdvancedEdit: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
}) {
  const { t } = useTranslation(['transactions', 'common']);
  const [notesDraft, setNotesDraft] = useState('');
  const [catDraft, setCatDraft] = useState<number | null>(null);

  useEffect(() => {
    if (tx) {
      setNotesDraft(tx.notes ?? '');
      setCatDraft(tx.categoryId ?? null);
    }
  }, [tx]);

  // Lock the background from scrolling while the sheet is open — mobile
  // sheets usually pin the page, and touch-scrolling the page under the
  // sheet feels broken.
  useEffect(() => {
    if (!tx) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [tx]);

  const currency = account?.currency ?? 'EUR';

  const dirtyNotes = tx ? notesDraft !== (tx.notes ?? '') : false;
  const dirtyCat = tx ? catDraft !== (tx.categoryId ?? null) : false;
  const canSave = dirtyNotes || dirtyCat;

  const commit = () => {
    if (!tx) return;
    if (dirtyNotes) onUpdateNotes(tx.id, { notes: notesDraft || null });
    if (dirtyCat) onUpdateCategory(tx.id, { categoryId: catDraft });
    onClose();
  };

  const categoriesForPicker = useMemo(
    () => [{ id: null as number | null, label: '—' }, ...sortedCategories.map((c) => ({ id: c.id as number | null, label: formatCategoryPath(c, catById) }))],
    [sortedCategories, catById],
  );

  if (!tx) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end md:hidden"
    >
      <button
        type="button"
        aria-label={t('close', { ns: 'common' })}
        className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-h-[85vh] rounded-t-2xl bg-ink-900 border-t border-ink-800 shadow-card flex flex-col animate-[slideup_0.18s_ease-out]">
        <div className="flex items-center justify-center pt-2 pb-1">
          <span className="block h-1 w-10 rounded-full bg-ink-700" aria-hidden />
        </div>

        <div className="px-4 pb-3 border-b border-ink-800/70">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-ink-100 font-medium" title={tx.rawLabel}>
                {tx.rawLabel}
              </div>
              <div className="text-[11px] text-ink-500 mt-0.5">
                <span className="font-mono">{formatDate(tx.date)}</span>
                <span aria-hidden> · </span>
                <span>{account?.name ?? '?'}</span>
              </div>
            </div>
            <div className={`font-mono text-sm tabular-nums whitespace-nowrap ${amountSignClass(tx.amount)}`}>
              {formatAmount(tx.amount, currency)}
            </div>
          </div>
        </div>

        <div className="px-4 py-4 overflow-y-auto flex flex-col gap-4 flex-1">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sheet-notes" className="label">
              {t('table.columns.notes')}
            </label>
            <textarea
              id="sheet-notes"
              rows={3}
              className="input-sm w-full resize-y"
              placeholder="…"
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              maxLength={2000}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="label">{t('table.columns.category')}</span>
            <ul className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-1 -mr-1">
              {categoriesForPicker.map((c) => {
                const selected = catDraft === c.id;
                return (
                  <li key={c.id ?? 'none'}>
                    <button
                      type="button"
                      onClick={() => setCatDraft(c.id)}
                      className={`w-full text-left px-3 py-2 rounded border transition ${
                        selected
                          ? 'border-sage-700 bg-sage-900/30 text-sage-100'
                          : 'border-ink-800 hover:bg-ink-850 text-ink-200'
                      }`}
                      aria-pressed={selected}
                    >
                      {c.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-ink-800/70 flex flex-wrap items-center gap-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button type="button" className="btn-ghost text-clay-300" onClick={() => onDelete(tx)}>
            {t('delete', { ns: 'common' })}
          </button>
          <button type="button" className="btn-ghost text-ink-300" onClick={() => onAdvancedEdit(tx)}>
            {t('row.advancedEditLabel')}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              {t('cancel', { ns: 'common' })}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!canSave}
              onClick={commit}
            >
              {t('save', { ns: 'common' })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
