import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Account, Category, Transaction } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TransactionsTable } from './TransactionsTable';
import { FiltersBar } from './FiltersBar';
import { TransactionModal } from './TransactionModal';
import { parseAmountQuery } from './parseAmountQuery';

export interface Filters {
  accountId?: number;
  categoryId?: number;
  fromDate?: string;
  toDate?: string;
  search?: string;
  amount?: string;
  sort: 'date' | 'amount' | 'label';
  order: 'asc' | 'desc';
}

const PAGE = 50;

export function Transactions() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  // Pick up an optional ?accountId=… from the URL so links from the dashboard
  // land on the right pre-filtered view.
  const initialAccountId = (() => {
    const v = searchParams.get('accountId');
    if (!v) return undefined;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  })();
  const [filters, setFilters] = useState<Filters>({
    sort: 'date',
    order: 'desc',
    accountId: initialAccountId,
  });
  const [searchInput, setSearchInput] = useState('');
  const [offset, setOffset] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  // null means "create"; a Transaction means "edit"; undefined means "closed".
  const [modalTx, setModalTx] = useState<Transaction | null | undefined>(undefined);
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Whenever the search input changes, route it to either `amount` or
  // `search`. We never send both at once.
  const onSearchChange = (value: string) => {
    setSearchInput(value);
    setOffset(0);
    const amt = parseAmountQuery(value);
    if (amt !== null) {
      setFilters((f) => ({ ...f, amount: amt, search: undefined }));
    } else {
      setFilters((f) => ({ ...f, amount: undefined, search: value || undefined }));
    }
  };

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const categoriesQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });

  const txQ = useQuery({
    queryKey: ['transactions', filters, offset],
    queryFn: () =>
      api<{
        transactions: Transaction[];
        pagination: { total: number; limit: number; offset: number };
      }>('/api/transactions', {
        query: { ...filters, limit: PAGE, offset },
      }),
  });

  const updateCategory = useMutation({
    mutationFn: ({ id, categoryId }: { id: number; categoryId: number | null }) =>
      api<{ transaction: Transaction }>(`/api/transactions/${id}`, {
        method: 'PATCH',
        json: { categoryId },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions'] }),
  });

  const updateNotes = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string | null }) =>
      api<{ transaction: Transaction }>(`/api/transactions/${id}`, {
        method: 'PATCH',
        json: { notes },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions'] }),
  });

  const deleteTransaction = useMutation({
    mutationFn: (id: number) => api(`/api/transactions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['tri-groups'] });
      setDeletingTx(null);
      setDeleteError(null);
    },
    onError: (err: ApiError) => setDeleteError(err.message),
  });

  const accounts = accountsQ.data?.accounts ?? [];
  const categories = categoriesQ.data?.categories ?? [];
  const txs = txQ.data?.transactions ?? [];
  const total = txQ.data?.pagination.total ?? 0;

  const accountById = new Map(accounts.map((a) => [a.id, a] as const));

  return (
    <div className="flex flex-col gap-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Transactions</h1>
          <p className="page-subtitle">{total.toLocaleString('fr-FR')} ligne{total > 1 ? 's' : ''} au total</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary md:hidden" onClick={() => setShowFilters((s) => !s)}>
            {showFilters ? 'Masquer' : 'Filtres'}
          </button>
          <button className="btn-primary" onClick={() => setModalTx(null)}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Nouvelle transaction
          </button>
        </div>
      </div>

      <FiltersBar
        filters={filters}
        searchInput={searchInput}
        accounts={accounts}
        categories={categories}
        showAdvanced={showFilters}
        onToggleAdvanced={() => setShowFilters((s) => !s)}
        onFilterChange={(patch) => {
          setOffset(0);
          setFilters((f) => ({ ...f, ...patch }));
        }}
        onSearchInputChange={onSearchChange}
      />

      <TransactionsTable
        transactions={txs}
        categories={categories}
        accountById={accountById}
        isLoading={txQ.isLoading}
        filters={filters}
        setFilters={setFilters}
        setOffset={setOffset}
        onUpdateCategory={(id, patch) => updateCategory.mutate({ id, ...patch })}
        onUpdateNotes={(id, patch) => updateNotes.mutate({ id, ...patch })}
        onEdit={(tx) => setModalTx(tx)}
        onDelete={(tx) => {
          setDeleteError(null);
          setDeletingTx(tx);
        }}
      />

      <div className="flex items-center justify-between text-sm text-ink-400">
        <div className="font-mono text-xs">
          {total === 0 ? '0–0' : `${offset + 1}–${Math.min(offset + PAGE, total)}`} sur {total}
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            ‹
          </button>
          <button className="btn-secondary" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
            ›
          </button>
        </div>
      </div>

      <TransactionModal
        // modalTx undefined = closed; null = create; Transaction = edit.
        open={modalTx !== undefined}
        transaction={modalTx ?? null}
        onClose={() => setModalTx(undefined)}
        accounts={accounts}
        categories={categories}
      />

      <ConfirmDialog
        open={!!deletingTx}
        title={
          deletingTx
            ? `Supprimer la transaction « ${truncate(deletingTx.rawLabel, 40)} » ?`
            : ''
        }
        description={
          <>
            Cette action est <span className="display-italic">irréversible</span>. Si la
            transaction fait partie d'un virement interne, la jambe miroir est délinkée
            (transfer_group_id mis à null) pour ne pas devenir invisible dans les agrégats.
          </>
        }
        confirmLabel="Supprimer la transaction"
        destructive
        busy={deleteTransaction.isPending}
        error={deleteError}
        onConfirm={() => deletingTx && deleteTransaction.mutate(deletingTx.id)}
        onCancel={() => {
          setDeletingTx(null);
          setDeleteError(null);
        }}
      />
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
