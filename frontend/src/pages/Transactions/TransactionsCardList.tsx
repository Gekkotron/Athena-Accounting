import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Account, Category, Transaction } from '../../api/types';
import { formatAmount, amountSignClass } from '../../lib/format';
import { formatCategoryPath } from '../../lib/categories';

// Mobile ledger view: transactions grouped by date, with a Fraunces italic
// day header threading across each group — the design's one bold moment,
// echoing a paper ledger's date entry. Everything else stays quiet so the
// amounts and labels carry the eye.
export function TransactionsCardList({
  transactions,
  catById,
  accountById,
  isLoading,
  onTap,
}: {
  transactions: Transaction[];
  catById: Map<number, Category>;
  accountById: Map<number, Account>;
  isLoading: boolean;
  onTap: (tx: Transaction) => void;
}) {
  const { t, i18n } = useTranslation(['transactions', 'common']);
  const locale = i18n.language.startsWith('en') ? 'en-US' : 'fr-FR';

  // Group into ordered [date, transactions[]] pairs. `transactions` is
  // already server-sorted by (date desc, id desc) so a single pass is
  // enough — no explicit sort here.
  const groups = useMemo(() => {
    const acc: Array<{ date: string; rows: Transaction[] }> = [];
    for (const tx of transactions) {
      const last = acc[acc.length - 1];
      if (last && last.date === tx.date) last.rows.push(tx);
      else acc.push({ date: tx.date, rows: [tx] });
    }
    return acc;
  }, [transactions]);

  if (transactions.length === 0) {
    return (
      <div className="surface px-4 py-14 text-center text-ink-500 display-italic text-lg">
        {isLoading ? t('loading', { ns: 'common' }) : t('table.empty')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {groups.map(({ date, rows }) => {
        const d = new Date(`${date}T00:00:00`);
        const dayLabel = d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
        const dayNum = d.toLocaleDateString(locale, { day: '2-digit' });
        return (
          <section key={date} aria-labelledby={`day-${date}`}>
            {/* Day divider — the signature. Fraunces italic date on a
                hairline, mono day number sitting in the left gutter so
                the eye picks up "which day" before "which merchant". */}
            <header className="flex items-baseline gap-3 mb-2 px-1">
              <span className="font-mono text-[11px] text-ink-500 tabular-nums w-6 shrink-0">{dayNum}</span>
              <h2
                id={`day-${date}`}
                className="display-italic text-sage-200/90 text-lg leading-none tracking-tight"
              >
                {dayLabel}
              </h2>
              <span aria-hidden className="flex-1 h-px bg-ink-800/70" />
            </header>

            <ul className="flex flex-col divide-y divide-ink-800/40 surface overflow-hidden">
              {rows.map((tx) => {
                const account = accountById.get(tx.accountId);
                const cat = tx.categoryId ? catById.get(tx.categoryId) : null;
                const currency = account?.currency ?? 'EUR';
                return (
                  <li key={tx.id}>
                    <button
                      type="button"
                      onClick={() => onTap(tx)}
                      className="w-full text-left px-4 py-3.5 hover:bg-ink-850/40 active:bg-ink-850/70 transition-colors touch-manipulation"
                    >
                      <div className="flex items-baseline gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-ink-100 text-[15px] leading-tight" title={tx.rawLabel}>
                            {tx.rawLabel}
                          </div>
                          <div className="mt-1 text-[12px] text-ink-500 leading-tight flex items-center gap-1.5 flex-wrap">
                            <span className={cat ? 'text-ink-300' : 'text-ink-600 display-italic'}>
                              {cat ? formatCategoryPath(cat, catById) : t('table.uncategorized', { defaultValue: '—' })}
                            </span>
                            <span aria-hidden className="text-ink-700">·</span>
                            <span className="truncate">{account?.name ?? '?'}</span>
                            {tx.transferGroupId && (
                              <>
                                <span aria-hidden className="text-ink-700">·</span>
                                <span className="text-amber-300/80">↹ {t('row.internalTransferBadge')}</span>
                              </>
                            )}
                          </div>
                          {tx.notes && (
                            <div
                              className="mt-1 text-[12px] text-ink-400 display-italic truncate"
                              title={tx.notes}
                            >
                              “{tx.notes}”
                            </div>
                          )}
                        </div>
                        <div className={`font-mono text-[15px] tabular-nums whitespace-nowrap self-start pt-0.5 ${amountSignClass(tx.amount)}`}>
                          {formatAmount(tx.amount, currency)}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
