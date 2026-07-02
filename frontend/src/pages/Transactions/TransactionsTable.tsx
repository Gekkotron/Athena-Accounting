import { useEffect, useRef } from 'react';
import type { Account, Category, Transaction } from '../../api/types';
import type { Filters } from './index';
import { Th } from './Th';
import { TransactionRow } from './TransactionRow';

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
}) {
  const visibleSelected = transactions.filter((t) => selectedIds.has(t.id)).length;
  const allSelected = transactions.length > 0 && visibleSelected === transactions.length;
  const partiallySelected = visibleSelected > 0 && !allSelected;

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
              <th className="px-2 py-3 text-center">
                <input
                  ref={headerCheckbox}
                  type="checkbox"
                  className="align-middle accent-sage-300"
                  checked={allSelected}
                  onChange={(e) => onToggleSelectAll(e.target.checked)}
                  aria-label="Tout sélectionner sur cette page"
                  disabled={transactions.length === 0}
                />
              </th>
              <Th sort="date" filters={filters} setFilters={setFilters} setOffset={setOffset}>Date</Th>
              <th className="px-4 py-3 label font-normal hidden sm:table-cell">Compte</th>
              <Th sort="label" filters={filters} setFilters={setFilters} setOffset={setOffset}>Libellé</Th>
              <th className="px-4 py-3 label font-normal">Catégorie</th>
              <th className="px-4 py-3 label font-normal hidden md:table-cell">Notes</th>
              <Th sort="amount" filters={filters} setFilters={setFilters} setOffset={setOffset} align="right">Montant</Th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-ink-500 display-italic">
                  {isLoading ? 'Chargement…' : 'Aucune transaction.'}
                </td>
              </tr>
            ) : (
              transactions.map((t) => (
                <TransactionRow
                  key={t.id}
                  tx={t}
                  account={accountById.get(t.accountId)}
                  categories={categories}
                  selected={selectedIds.has(t.id)}
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
