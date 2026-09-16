import type { Account, Category, Transaction } from '../../api/types';
import { formatCategoryPath } from '../../lib/categories';

// The extra rows that render below a transaction when it is expanded and
// has split lines. One <tr> per split; column widths mirror the parent
// row so the visual alignment stays intact.
export function TransactionSplitRows({
  tx, catById, account, showBalance,
}: {
  tx: Transaction;
  catById: Map<number, Category>;
  account: Account | undefined;
  showBalance: boolean;
}): JSX.Element {
  return (
    <>
      {tx.splits.map((s) => {
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
}
