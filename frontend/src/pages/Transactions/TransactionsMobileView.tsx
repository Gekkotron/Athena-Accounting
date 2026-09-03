import { useState } from 'react';
import type { Account, Category, Transaction } from '../../api/types';
import { TransactionsCardList } from './TransactionsCardList';
import { QuickEditSheet } from './QuickEditSheet';

// Mobile-only renderer for the transactions list — owns the tapped-card
// state so the parent page doesn't need it. Keeps index.tsx below the
// 300-line lint cap without changing the desktop code path.
export function TransactionsMobileView({
  transactions,
  accountById,
  catById,
  sortedCategories,
  isLoading,
  onUpdateCategory,
  onUpdateNotes,
  onAdvancedEdit,
  onDelete,
}: {
  transactions: Transaction[];
  accountById: Map<number, Account>;
  catById: Map<number, Category>;
  sortedCategories: Category[];
  isLoading: boolean;
  onUpdateCategory: (id: number, patch: { categoryId: number | null }) => void;
  onUpdateNotes: (id: number, patch: { notes: string | null }) => void;
  onAdvancedEdit: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
}) {
  const [sheetTx, setSheetTx] = useState<Transaction | null>(null);
  return (
    <>
      <TransactionsCardList
        transactions={transactions}
        catById={catById}
        accountById={accountById}
        isLoading={isLoading}
        onTap={setSheetTx}
      />
      <QuickEditSheet
        tx={sheetTx}
        account={sheetTx ? accountById.get(sheetTx.accountId) : undefined}
        sortedCategories={sortedCategories}
        catById={catById}
        onClose={() => setSheetTx(null)}
        onUpdateNotes={onUpdateNotes}
        onUpdateCategory={onUpdateCategory}
        onAdvancedEdit={(tx) => {
          setSheetTx(null);
          onAdvancedEdit(tx);
        }}
        onDelete={(tx) => {
          setSheetTx(null);
          onDelete(tx);
        }}
      />
    </>
  );
}
