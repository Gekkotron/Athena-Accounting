import { useTranslation } from 'react-i18next';
import type { Account, Category, Transaction } from '../../api/types';
import { formatAmount, formatDate, amountSignClass } from '../../lib/format';
import { formatCategoryPath } from '../../lib/categories';

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
  const { t } = useTranslation(['transactions', 'common']);

  if (transactions.length === 0) {
    return (
      <div className="surface px-4 py-10 text-center text-ink-500 display-italic">
        {isLoading ? t('loading', { ns: 'common' }) : t('table.empty')}
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {transactions.map((tx) => {
        const account = accountById.get(tx.accountId);
        const cat = tx.categoryId ? catById.get(tx.categoryId) : null;
        const currency = account?.currency ?? 'EUR';
        return (
          <li key={tx.id}>
            <button
              type="button"
              onClick={() => onTap(tx)}
              className="surface w-full text-left px-4 py-3 hover:bg-ink-850/60 transition active:scale-[0.995] touch-manipulation"
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-ink-100 font-medium" title={tx.rawLabel}>
                    {tx.rawLabel}
                  </div>
                  <div className="text-[11px] text-ink-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono">{formatDate(tx.date)}</span>
                    <span aria-hidden>·</span>
                    <span className="truncate">{account?.name ?? '?'}</span>
                    {tx.transferGroupId && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="text-amber-300/80">↹ {t('row.internalTransferBadge')}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className={`font-mono text-sm tabular-nums whitespace-nowrap ${amountSignClass(tx.amount)}`}>
                  {formatAmount(tx.amount, currency)}
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full border ${
                    cat
                      ? 'border-sage-800/60 text-sage-200 bg-sage-900/20'
                      : 'border-ink-800 text-ink-500'
                  }`}
                >
                  {cat ? formatCategoryPath(cat, catById) : '—'}
                </span>
                {tx.notes && (
                  <span
                    className="text-[11px] text-ink-400 truncate max-w-[60%]"
                    title={tx.notes}
                  >
                    “{tx.notes}”
                  </span>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
