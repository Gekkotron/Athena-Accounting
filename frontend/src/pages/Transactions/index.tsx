import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Account, Category, Transaction, BalanceCheckpoint } from '../../api/types';
import { formatCategoryPath } from '../../lib/categories';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TransactionsTable } from './TransactionsTable';
import { FiltersBar } from './FiltersBar';
import { TransactionModal } from './TransactionModal';
import { parseAmountQuery } from './parseAmountQuery';
import { listCheckpoints, createCheckpoint, deleteCheckpoint } from '../../api/checkpoints';

export interface Filters {
  accountId?: number;
  categoryId?: number;
  sourceFileId?: number;
  fromDate?: string;
  toDate?: string;
  search?: string;
  amount?: string;
  sort: 'date' | 'amount' | 'label';
  order: 'asc' | 'desc';
}

const PAGE = 50;

// URL-param → positive-int-or-undefined, shared across the initial reads.
function readIntParam(sp: URLSearchParams, key: string): number | undefined {
  const v = sp.get(key);
  if (!v) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function Transactions() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  // Pick up an optional ?accountId=… / ?sourceFileId=… from the URL so
  // links from Dashboard or Imports land on the right pre-filtered view.
  const initialAccountId = readIntParam(searchParams, 'accountId');
  const initialSourceFileId = readIntParam(searchParams, 'sourceFileId');
  const [filters, setFilters] = useState<Filters>({
    sort: 'date',
    order: 'desc',
    accountId: initialAccountId,
    sourceFileId: initialSourceFileId,
  });
  const [searchInput, setSearchInput] = useState('');
  const [offset, setOffset] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  // null means "create"; a Transaction means "edit"; undefined means "closed".
  const [modalTx, setModalTx] = useState<Transaction | null | undefined>(undefined);
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [bulkSelectValue, setBulkSelectValue] = useState('');
  const [bulkCategorizeNotice, setBulkCategorizeNotice] = useState<{ skipped: number } | null>(null);
  const [bulkCategorizeError, setBulkCategorizeError] = useState<string | null>(null);
  const [pendingCheckpointDate, setPendingCheckpointDate] = useState<string | null>(null);
  const [checkpointError, setCheckpointError] = useState<string | null>(null);

  // Reset the selection whenever the visible set changes (filter or page).
  // Otherwise selectedIds may contain rows the user can no longer see, and
  // acting on them would feel like surprise-deletion.
  useEffect(() => {
    setSelectedIds(new Set());
    setExpandedIds(new Set());
    setBulkCategorizeNotice(null);
    setBulkCategorizeError(null);
  }, [filters, offset]);

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

  const checkpointsQ = useQuery({
    queryKey: ['balance-checkpoints', filters.accountId],
    queryFn: () => listCheckpoints(filters.accountId!),
    enabled: filters.accountId != null,
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

  const bulkDelete = useMutation({
    mutationFn: (ids: number[]) =>
      api<{ deleted: number }>('/api/transactions/delete-bulk', {
        method: 'POST',
        json: { ids },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['tri-groups'] });
      setConfirmBulkDelete(false);
      setBulkDeleteError(null);
      setSelectedIds(new Set());
    },
    onError: (err: ApiError) => setBulkDeleteError(err.message),
  });

  const bulkCategorize = useMutation({
    mutationFn: (vars: { ids: number[]; categoryId: number | null }) =>
      api<{ updated: number; skipped: number }>('/api/transactions/categorize-bulk', {
        method: 'POST',
        json: vars,
      }),
    onSuccess: ({ skipped }) => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['tri-groups'] });
      setSelectedIds(new Set());
      setBulkSelectValue('');
      setBulkCategorizeError(null);
      setBulkCategorizeNotice(skipped > 0 ? { skipped } : null);
    },
    onError: (err: ApiError) => {
      setBulkSelectValue('');
      setBulkCategorizeError(err.message);
    },
  });

  const createCheckpointM = useMutation({
    mutationFn: (vars: { accountId: number; date: string; amount: string }) =>
      createCheckpoint(vars.accountId, {
        checkpointDate: vars.date,
        expectedAmount: vars.amount,
        note: null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balance-checkpoints'] });
      setCheckpointError(null);
    },
    onError: (err: ApiError) => setCheckpointError(err.message),
    onSettled: () => setPendingCheckpointDate(null),
  });

  const removeCheckpointM = useMutation({
    mutationFn: (vars: { accountId: number; cpId: number }) =>
      deleteCheckpoint(vars.accountId, vars.cpId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balance-checkpoints'] });
      setCheckpointError(null);
    },
    onError: (err: ApiError) => setCheckpointError(err.message),
    onSettled: () => setPendingCheckpointDate(null),
  });

  const accounts = accountsQ.data?.accounts ?? [];
  const categories = categoriesQ.data?.categories ?? [];
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c] as const)), [categories]);
  const sortedCategories = useMemo(
    () =>
      [...categories].sort((a, b) => {
        const pa = a.parentId != null ? catById.get(a.parentId)?.name ?? '' : a.name;
        const pb = b.parentId != null ? catById.get(b.parentId)?.name ?? '' : b.name;
        return pa.localeCompare(pb) || a.name.localeCompare(b.name);
      }),
    [categories, catById],
  );
  const txs = txQ.data?.transactions ?? [];
  const total = txQ.data?.pagination.total ?? 0;

  const accountById = new Map(accounts.map((a) => [a.id, a] as const));

  const checkpointByDate: Map<string, BalanceCheckpoint> = new Map(
    (checkpointsQ.data?.checkpoints ?? []).map((c) => [c.checkpointDate, c] as const),
  );

  const onToggleCheckpoint = (tx: Transaction, checked: boolean) => {
    const accId = filters.accountId;
    if (accId == null || tx.runningBalance == null) return;
    setPendingCheckpointDate(tx.date);
    if (checked) {
      createCheckpointM.mutate({ accountId: accId, date: tx.date, amount: tx.runningBalance });
    } else {
      const cp = checkpointByDate.get(tx.date);
      if (cp) removeCheckpointM.mutate({ accountId: accId, cpId: cp.id });
      else setPendingCheckpointDate(null);
    }
  };

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

      {filters.sourceFileId != null && (
        <div className="rounded-lg border border-sage-800/40 bg-sage-900/10 px-3 py-2 flex items-center justify-between gap-3 text-xs">
          <span className="text-ink-200">
            Filtré par import{' '}
            <span className="font-mono text-sage-300">#{filters.sourceFileId}</span>{' '}
            <span className="text-ink-500">
              — seules les transactions issues de ce fichier sont affichées.
            </span>
          </span>
          <button
            className="text-ink-500 hover:text-ink-100 transition"
            onClick={() => {
              setOffset(0);
              setFilters((f) => ({ ...f, sourceFileId: undefined }));
            }}
          >
            Retirer ce filtre
          </button>
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="rounded-lg border border-sage-800/40 bg-sage-900/15 px-4 py-2 flex items-center justify-between gap-3 text-sm">
          <span className="text-ink-100">
            <span className="font-mono">{selectedIds.size}</span> sélectionnée{selectedIds.size > 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="text-[11px] text-ink-500 hover:text-ink-100 transition"
              onClick={() => setSelectedIds(new Set())}
            >
              Effacer la sélection
            </button>
            <select
              className="input-sm"
              value={bulkSelectValue}
              disabled={bulkCategorize.isPending}
              aria-label="Changer la catégorie des transactions sélectionnées"
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                setBulkSelectValue('');
                bulkCategorize.mutate({
                  ids: Array.from(selectedIds),
                  categoryId: v === 'none' ? null : Number(v),
                });
              }}
            >
              <option value="" disabled>Catégorie…</option>
              <option value="none">— Aucune</option>
              {sortedCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {formatCategoryPath(c, catById)}
                </option>
              ))}
            </select>
            <button
              className="btn-secondary !py-1.5 !px-3 text-clay-300 hover:text-clay-200 border-clay-800/60 hover:border-clay-700"
              onClick={() => { setBulkDeleteError(null); setConfirmBulkDelete(true); }}
            >
              Supprimer
            </button>
          </div>
        </div>
      )}

      {bulkCategorizeNotice && (
        <div className="rounded-lg border border-sage-800/40 bg-sage-900/10 px-4 py-2 flex items-center justify-between gap-3 text-sm">
          <span className="text-ink-200">
            {bulkCategorizeNotice.skipped} ligne{bulkCategorizeNotice.skipped > 1 ? 's' : ''} ignorée{bulkCategorizeNotice.skipped > 1 ? 's' : ''} (virements internes ou ventilations)
          </span>
          <button
            className="text-[11px] text-ink-500 hover:text-ink-100 transition"
            onClick={() => setBulkCategorizeNotice(null)}
          >
            Fermer
          </button>
        </div>
      )}

      {bulkCategorizeError && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/15 px-4 py-2 flex items-center justify-between gap-3 text-sm">
          <span className="text-clay-200">Changement de catégorie : {bulkCategorizeError}</span>
          <button
            className="text-[11px] text-ink-500 hover:text-ink-100 transition"
            onClick={() => setBulkCategorizeError(null)}
          >
            Fermer
          </button>
        </div>
      )}

      {checkpointError && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/15 px-4 py-2 flex items-center justify-between gap-3 text-sm">
          <span className="text-clay-200">
            Point de contrôle : {checkpointError}
          </span>
          <button
            className="text-[11px] text-ink-500 hover:text-ink-100 transition"
            onClick={() => setCheckpointError(null)}
          >
            Fermer
          </button>
        </div>
      )}

      <TransactionsTable
        transactions={txs}
        categories={categories}
        accountById={accountById}
        checkpointByDate={checkpointByDate}
        pendingCheckpointDate={pendingCheckpointDate}
        onToggleCheckpoint={onToggleCheckpoint}
        isLoading={txQ.isLoading}
        filters={filters}
        setFilters={setFilters}
        setOffset={setOffset}
        selectedIds={selectedIds}
        onToggleSelect={(id, checked) => {
          setSelectedIds((s) => {
            const next = new Set(s);
            if (checked) next.add(id); else next.delete(id);
            return next;
          });
        }}
        onToggleSelectAll={(checked) => {
          setSelectedIds((s) => {
            const next = new Set(s);
            for (const t of txs) {
              if (checked) next.add(t.id); else next.delete(t.id);
            }
            return next;
          });
        }}
        onUpdateCategory={(id, patch) => updateCategory.mutate({ id, ...patch })}
        onUpdateNotes={(id, patch) => updateNotes.mutate({ id, ...patch })}
        expandedIds={expandedIds}
        onToggleExpanded={(id) => {
          setExpandedIds((s) => {
            const next = new Set(s);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        }}
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

      <ConfirmDialog
        open={confirmBulkDelete}
        title={`Supprimer ${selectedIds.size} transaction${selectedIds.size > 1 ? 's' : ''} ?`}
        description={
          <>
            Cette action est <span className="display-italic">irréversible</span>. Toute
            jambe miroir de virement interne est délinkée avant la suppression.
          </>
        }
        confirmLabel="Supprimer"
        destructive
        busy={bulkDelete.isPending}
        error={bulkDeleteError}
        onConfirm={() => bulkDelete.mutate(Array.from(selectedIds))}
        onCancel={() => { setConfirmBulkDelete(false); setBulkDeleteError(null); }}
      />
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
