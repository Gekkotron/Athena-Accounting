import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Account, Category, Transaction, BalanceCheckpoint } from '../../api/types';
import type { Filters } from './filters';
import { Th } from './Th';
import { TransactionRow } from './TransactionRow';
import { endOfDayRowIds } from './endOfDay';

export function TransactionsTable({
  transactions,
  categories,
  accountById,
  isLoading,
  filters,
  setFilters,
  setOffset,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onUpdateCategory,
  onUpdateNotes,
  onEdit,
  onDelete,
  expandedIds,
  onToggleExpanded,
  checkpointByDate,
  pendingCheckpointDate,
  onToggleCheckpoint,
  firstRowRef,
  multiSelectRef,
}: {
  transactions: Transaction[];
  categories: Category[];
  accountById: Map<number, Account>;
  isLoading: boolean;
  filters: Filters;
  setFilters: (fn: (f: Filters) => Filters) => void;
  setOffset: (n: number) => void;
  selectedIds: Set<number>;
  onToggleSelect: (id: number, checked: boolean) => void;
  onToggleSelectAll: (checked: boolean) => void;
  onUpdateCategory: (id: number, patch: { categoryId: number | null }) => void;
  onUpdateNotes: (id: number, patch: { notes: string | null }) => void;
  onEdit: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
  expandedIds: Set<number>;
  onToggleExpanded: (id: number) => void;
  checkpointByDate: Map<string, BalanceCheckpoint>;
  pendingCheckpointDate: string | null;
  onToggleCheckpoint: (tx: Transaction, checked: boolean) => void;
  // Tour anchors — attached to the first data row and the multi-select
  // checkbox column header respectively. Optional so standalone unit tests
  // can render the table without wiring the tour system.
  firstRowRef?: (el: HTMLTableRowElement | null) => void;
  multiSelectRef?: (el: HTMLElement | null) => void;
}) {
  const { t } = useTranslation(['transactions', 'common']);
  const visibleSelected = transactions.filter((tx) => selectedIds.has(tx.id)).length;
  const allSelected = transactions.length > 0 && visibleSelected === transactions.length;
  const partiallySelected = visibleSelected > 0 && !allSelected;
  const showBalance = filters.accountId != null && filters.sort === 'date';
  const endOfDayIds = showBalance ? endOfDayRowIds(transactions) : new Set<number>();

  const headerCheckbox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = partiallySelected;
  }, [partiallySelected]);

  return (
    <div className="surface overflow-hidden">
      <div className="table-scroll">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr className="border-b border-ink-800/70">
              <th ref={multiSelectRef} className="px-2 py-3 text-center">
                <input
                  ref={headerCheckbox}
                  type="checkbox"
                  className="align-middle accent-sage-300"
                  checked={allSelected}
                  onChange={(e) => onToggleSelectAll(e.target.checked)}
                  aria-label={t('table.selectAllAriaLabel')}
                  disabled={transactions.length === 0}
                />
              </th>
              <Th sort="date" filters={filters} setFilters={setFilters} setOffset={setOffset}>{t('table.columns.date')}</Th>
              <th className="px-4 py-3 label font-normal hidden sm:table-cell">{t('table.columns.account')}</th>
              <Th sort="label" filters={filters} setFilters={setFilters} setOffset={setOffset}>{t('table.columns.label')}</Th>
              <th className="px-4 py-3 label font-normal">{t('table.columns.category')}</th>
              <th className="px-4 py-3 label font-normal hidden md:table-cell">{t('table.columns.notes')}</th>
              <Th sort="amount" filters={filters} setFilters={setFilters} setOffset={setOffset} align="right">{t('table.columns.amount')}</Th>
              {showBalance && <th className="px-4 py-3 label font-normal text-right">{t('table.columns.balance')}</th>}
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={showBalance ? 9 : 8} className="px-4 py-10 text-center text-ink-500 display-italic">
                  {isLoading ? t('loading', { ns: 'common' }) : t('table.empty')}
                </td>
              </tr>
            ) : (
              transactions.map((tx, idx) => (
                <TransactionRow
                  key={tx.id}
                  ref={idx === 0 ? firstRowRef : undefined}
                  tx={tx}
                  account={accountById.get(tx.accountId)}
                  categories={categories}
                  selected={selectedIds.has(tx.id)}
                  expanded={expandedIds.has(tx.id)}
                  showBalance={showBalance}
                  isEndOfDay={endOfDayIds.has(tx.id)}
                  checkpoint={checkpointByDate.get(tx.date)}
                  checkpointPending={pendingCheckpointDate === tx.date}
                  onToggleCheckpoint={onToggleCheckpoint}
                  onToggleExpanded={onToggleExpanded}
                  onToggleSelect={onToggleSelect}
                  onUpdateCategory={onUpdateCategory}
                  onUpdateNotes={onUpdateNotes}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
