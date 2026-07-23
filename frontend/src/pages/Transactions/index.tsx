import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Account, Category, Transaction, BalanceCheckpoint } from '../../api/types';
import { useAutoStartTour } from '../../hooks/useAutoStartTour';
import { useTourAnchor } from '../../hooks/useTourAnchor';
import { TourReplayIcon } from '../../components/TourReplayIcon';
import { TransactionsTable } from './TransactionsTable';
import { FiltersBar } from './FiltersBar';
import { TransactionModal } from './TransactionModal';
import { TransactionsNotices } from './TransactionsNotices';
import { TransactionsConfirmDialogs } from './TransactionsConfirmDialogs';
import { TransactionsPagination } from './TransactionsPagination';
import { useTransactionsMutations } from './useTransactionsMutations';
import { useDefaultAccountResolver } from './useDefaultAccountResolver';
import { parseAmountQuery } from './parseAmountQuery';
import { BulkSelectionBar } from './BulkSelectionBar';
import { readIntParam, sortCategoriesForPicker, toggleInSet } from './lib';
import { listCheckpoints } from '../../api/checkpoints';
import { ErrorState } from '../../components/StateBlocks';
import { useSettings } from '../../lib/useSettings';

export type { Filters } from './filters';
import type { Filters } from './filters';

const PAGE = 50;

export function Transactions() {
  const { t, i18n } = useTranslation(['transactions', 'common']);
  const locale = i18n.language.startsWith('en') ? 'en-US' : 'fr-FR';
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
  const { settings, isReady: settingsReady } = useSettings();
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

  const defaultResolved = useDefaultAccountResolver({
    initialAccountId,
    settingsReady,
    accounts: accountsQ.data?.accounts,
    transactionsDefaultAccount: settings.transactionsDefaultAccount,
    setFilters,
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
    enabled: defaultResolved,
  });

  useAutoStartTour('transactions', {
    requireData: () => (txQ.data?.transactions?.length ?? 0) > 0,
  });
  const searchAnchor = useTourAnchor('transactions:search');
  // rowAnchor targets the first data row (threaded into TransactionsTable
  // as `firstRowRef`, attached only when idx === 0 in the row map);
  // multiAnchor targets the multi-select checkbox column header (threaded
  // in as `multiSelectRef`, attached to the header <th>). Each anchor
  // lands on its own distinct element so the transactions tour's row /
  // multi-select steps visibly move the coach-mark, instead of both
  // pointing at the same wrapper.
  const rowAnchor = useTourAnchor('transactions:row');
  const multiAnchor = useTourAnchor('transactions:multi-select');

  const checkpointsQ = useQuery({
    queryKey: ['balance-checkpoints', filters.accountId],
    queryFn: () => listCheckpoints(filters.accountId!),
    enabled: filters.accountId != null,
  });

  const {
    updateCategory,
    updateNotes,
    deleteTransaction,
    bulkDelete,
    bulkCategorize,
    createCheckpointM,
    removeCheckpointM,
  } = useTransactionsMutations({
    setDeletingTx,
    setDeleteError,
    setConfirmBulkDelete,
    setBulkDeleteError,
    setSelectedIds,
    setBulkSelectValue,
    setBulkCategorizeError,
    setBulkCategorizeNotice,
    setCheckpointError,
    setPendingCheckpointDate,
  });

  const accounts = accountsQ.data?.accounts ?? [];
  const categories = categoriesQ.data?.categories ?? [];
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c] as const)), [categories]);
  const sortedCategories = useMemo(
    () => sortCategoriesForPicker(categories, catById),
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
          <div className="flex items-center gap-2">
            <h1 className="page-title">{t('title')}</h1>
            <TourReplayIcon pageId="transactions" />
          </div>
          <p className="page-subtitle">
            {t('subtitle', { count: total, formatted: total.toLocaleString(locale) })}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary md:hidden" onClick={() => setShowFilters((s) => !s)}>
            {showFilters ? t('filtersToggle.hide') : t('filtersToggle.show')}
          </button>
          <button className="btn-primary" onClick={() => setModalTx(null)}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            {t('actions.newTransaction')}
          </button>
        </div>
      </div>

      <div ref={searchAnchor}>
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
      </div>

      {selectedIds.size > 0 && (
        <BulkSelectionBar
          selectedIds={selectedIds}
          onClearSelection={() => setSelectedIds(new Set())}
          bulkSelectValue={bulkSelectValue}
          onBulkSelectValueChange={setBulkSelectValue}
          isBulkCategorizePending={bulkCategorize.isPending}
          onBulkCategorize={(categoryId) =>
            bulkCategorize.mutate({ ids: Array.from(selectedIds), categoryId })
          }
          sortedCategories={sortedCategories}
          catById={catById}
          onStartBulkDelete={() => {
            setBulkDeleteError(null);
            setConfirmBulkDelete(true);
          }}
        />
      )}

      <TransactionsNotices
        sourceFileId={filters.sourceFileId}
        onClearSourceFile={() => {
          setOffset(0);
          setFilters((f) => ({ ...f, sourceFileId: undefined }));
        }}
        bulkCategorizeNotice={bulkCategorizeNotice}
        onDismissBulkCategorizeNotice={() => setBulkCategorizeNotice(null)}
        bulkCategorizeError={bulkCategorizeError}
        onDismissBulkCategorizeError={() => setBulkCategorizeError(null)}
        checkpointError={checkpointError}
        onDismissCheckpointError={() => setCheckpointError(null)}
      />

      {txQ.isError ? (
        <ErrorState
          title={t('list.errorTitle')}
          error={txQ.error}
          onRetry={() => void txQ.refetch()}
        />
      ) : (
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
          onToggleSelect={(id, checked) => setSelectedIds((s) => toggleInSet(s, id, checked))}
          onToggleSelectAll={(checked) => {
            setSelectedIds((s) => {
              let next = s;
              for (const t of txs) next = toggleInSet(next, t.id, checked);
              return next;
            });
          }}
          onUpdateCategory={(id, patch) => updateCategory.mutate({ id, ...patch })}
          onUpdateNotes={(id, patch) => updateNotes.mutate({ id, ...patch })}
          expandedIds={expandedIds}
          onToggleExpanded={(id) => setExpandedIds((s) => toggleInSet(s, id, !s.has(id)))}
          onEdit={(tx) => setModalTx(tx)}
          onDelete={(tx) => {
            setDeleteError(null);
            setDeletingTx(tx);
          }}
          firstRowRef={rowAnchor}
          multiSelectRef={multiAnchor}
        />
      )}

      <TransactionsPagination
        total={total}
        offset={offset}
        pageSize={PAGE}
        onOffsetChange={setOffset}
      />

      <TransactionModal
        // modalTx undefined = closed; null = create; Transaction = edit.
        open={modalTx !== undefined}
        transaction={modalTx ?? null}
        onClose={() => setModalTx(undefined)}
        accounts={accounts}
        categories={categories}
      />

      <TransactionsConfirmDialogs
        deletingTx={deletingTx}
        deleteError={deleteError}
        isDeleting={deleteTransaction.isPending}
        onConfirmDelete={() => deletingTx && deleteTransaction.mutate(deletingTx.id)}
        onCancelDelete={() => {
          setDeletingTx(null);
          setDeleteError(null);
        }}
        confirmBulkDelete={confirmBulkDelete}
        bulkDeleteCount={selectedIds.size}
        bulkDeleteError={bulkDeleteError}
        isBulkDeleting={bulkDelete.isPending}
        onConfirmBulkDelete={() => bulkDelete.mutate(Array.from(selectedIds))}
        onCancelBulkDelete={() => {
          setConfirmBulkDelete(false);
          setBulkDeleteError(null);
        }}
      />
    </div>
  );
}
