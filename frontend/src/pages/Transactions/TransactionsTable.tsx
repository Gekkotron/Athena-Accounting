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
  onUpdateCategory: (id: number, patch: { categoryId: number | null }) => void;
  onUpdateNotes: (id: number, patch: { notes: string | null }) => void;
  onEdit: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
}) {
  return (
    <div className="surface overflow-hidden">
      <div className="table-scroll">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr className="border-b border-ink-800/70">
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
                <td colSpan={7} className="px-4 py-10 text-center text-ink-500 display-italic">
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
