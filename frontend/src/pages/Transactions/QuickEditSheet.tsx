import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Account, Category, Transaction } from '../../api/types';
import { formatAmount, formatDate, amountSignClass } from '../../lib/format';
import { formatCategoryPath } from '../../lib/categories';

// Mobile-only quick-edit affordance for a single transaction: notes +
// category. Reuses the app's three type roles — Fraunces italic for the
// merchant label (as a serif "entry"), Hanken for meta and controls,
// JetBrains for the amount — so the sheet reads as the same object the
// day-grouped list shows, just opened.
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

  // Lock the background from scrolling while the sheet is open — otherwise
  // the page peeks and scrolls behind the sheet, breaking the "focused on
  // this one entry" feeling.
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
    () => [
      { id: null as number | null, label: t('table.uncategorized', { defaultValue: '—' }), muted: true },
      ...sortedCategories.map((c) => ({ id: c.id as number | null, label: formatCategoryPath(c, catById), muted: false })),
    ],
    [sortedCategories, catById, t],
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
        className="absolute inset-0 bg-ink-950/75 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-h-[88vh] rounded-t-3xl bg-ink-900 border-t border-ink-800 shadow-card flex flex-col animate-[slideup_0.22s_cubic-bezier(0.2,0.8,0.2,1)]">
        <div className="flex items-center justify-center pt-2.5 pb-1">
          <span className="block h-1 w-9 rounded-full bg-ink-700" aria-hidden />
        </div>

        {/* Summary — merchant as a Fraunces italic entry, meta as a hairline
            beneath, amount right-aligned in the same mono weight the list uses. */}
        <div className="px-5 pt-2 pb-4 border-b border-ink-800/60">
          <div className="flex items-baseline justify-between gap-4">
            <div className="min-w-0">
              <div className="display-italic text-ink-50 text-xl truncate leading-tight" title={tx.rawLabel}>
                {tx.rawLabel}
              </div>
              <div className="mt-1.5 text-[11px] text-ink-500 flex items-center gap-1.5">
                <span className="font-mono tabular-nums">{formatDate(tx.date)}</span>
                <span aria-hidden className="text-ink-700">·</span>
                <span>{account?.name ?? '?'}</span>
              </div>
            </div>
            <div className={`font-mono text-lg tabular-nums whitespace-nowrap ${amountSignClass(tx.amount)}`}>
              {formatAmount(tx.amount, currency)}
            </div>
          </div>
        </div>

        <div className="px-5 py-5 overflow-y-auto flex flex-col gap-6 flex-1">
          {/* Note — bare textarea framed as "writing in the margin". No
              boxy input styling, just a single hairline underneath. */}
          <div className="flex flex-col gap-2">
            <span className="label">{t('table.columns.notes')}</span>
            <textarea
              id="sheet-notes"
              rows={2}
              className="w-full bg-transparent border-0 border-b border-ink-800 focus:border-sage-300/60 focus:outline-none text-[15px] text-ink-100 placeholder:text-ink-600 placeholder:display-italic px-0 py-1.5 resize-none transition-colors"
              placeholder={t('sheetNotesPlaceholder', { defaultValue: 'note…' })}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              maxLength={2000}
            />
          </div>

          {/* Categories — flush-list; selected item gets a left sage rail
              (no boxy border) so the picker reads as a chosen entry rather
              than a form control. */}
          <div className="flex flex-col gap-2">
            <span className="label">{t('table.columns.category')}</span>
            <ul className="flex flex-col max-h-[42vh] overflow-y-auto -mx-2">
              {categoriesForPicker.map((c) => {
                const selected = catDraft === c.id;
                return (
                  <li key={c.id ?? 'none'}>
                    <button
                      type="button"
                      onClick={() => setCatDraft(c.id)}
                      className={`w-full text-left pl-3 pr-3 py-3 text-[15px] flex items-center gap-3 border-l-2 transition-colors ${
                        selected
                          ? 'border-sage-300 bg-sage-900/20 text-sage-100'
                          : 'border-transparent hover:bg-ink-850/60 text-ink-200'
                      } ${c.muted && !selected ? 'display-italic text-ink-500' : ''}`}
                      aria-pressed={selected}
                    >
                      <span className="flex-1 truncate">{c.label}</span>
                      {selected && (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                          <path d="M3 7.5l2.5 2.5L11 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {/* Action row — Delete and Advanced sit quiet on the left as text
            buttons; the commit action is the only weighted button. */}
        <div className="px-5 py-3 border-t border-ink-800/60 flex items-center gap-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button type="button" className="text-[13px] text-clay-300/90 hover:text-clay-200 px-2 py-2 transition-colors" onClick={() => onDelete(tx)}>
            {t('delete', { ns: 'common' })}
          </button>
          <button type="button" className="text-[13px] text-ink-400 hover:text-ink-200 px-2 py-2 transition-colors" onClick={() => onAdvancedEdit(tx)}>
            {t('row.advancedEditLabel')}
          </button>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" className="text-[13px] text-ink-400 hover:text-ink-200 px-3 py-2 transition-colors" onClick={onClose}>
              {t('cancel', { ns: 'common' })}
            </button>
            <button
              type="button"
              className="btn-primary !py-2 !px-4 text-[13px]"
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
