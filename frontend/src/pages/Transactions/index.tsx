import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Account, Category, Transaction } from '../../api/types';
import { useAutoStartTour } from '../../hooks/useAutoStartTour';
import { useTourAnchor } from '../../hooks/useTourAnchor';
import { TransactionsHeader } from './TransactionsHeader';
import { TransactionsTable } from './TransactionsTable';
import { TransactionsMobileView } from './TransactionsMobileView';
import { FiltersBar } from './FiltersBar';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { TransactionModal } from './TransactionModal';
import { TransactionsNotices } from './TransactionsNotices';
import { TransactionsConfirmDialogs } from './TransactionsConfirmDialogs';
import { TransactionsPagination } from './TransactionsPagination';
import { useTransactionsMutations } from './useTransactionsMutations';
import { useDefaultAccountResolver } from './useDefaultAccountResolver';
import { parseAmountQuery } from './parseAmountQuery';
import { BulkSelectionBar } from './BulkSelectionBar';
import { readIntParam, sortCategoriesForPicker, toggleAllInSet, toggleInSet } from './lib';
import { useCheckpoints } from './useCheckpoints';
import { useDeferredDelete } from './useDeferredDelete';
import { useTransactionShortcuts } from './useTransactionShortcuts';
import { UndoToast } from './UndoToast';
import { ErrorState } from '../../components/StateBlocks';
import { useSettings } from '../../lib/useSettings';

export type { Filters } from './filters';
import type { Filters } from './filters';

const PAGE = 50;

export function Transactions() {
  const { t } = useTranslation(['transactions', 'common']);
  const [searchParams] = useSearchParams();
  // Pick up an optional ?accountId=… / ?sourceFileId=… from the URL so
  // links from Dashboard or Imports land on the right pre-filtered view.
  const initialAccountId = readIntParam(searchParams, 'accountId');
  const initialSourceFileId = readIntParam(searchParams, 'sourceFileId');
  const [filters, setFilters] = useState<Filters>({ sort: 'date', order: 'desc', accountId: initialAccountId, sourceFileId: initialSourceFileId });
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
  // Mobile swaps the <table> for a card list + bottom sheet. `max-width:
  // 767px` matches "below Tailwind's md breakpoint" and, importantly, returns
  // `false` when window.matchMedia is unavailable (jsdom) — so unit tests
  // and SSR default to the desktop table.
  const isMobile = useMediaQuery('(max-width: 767px)');

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

  const { updateCategory, updateNotes, deleteTransaction, bulkDelete, bulkCategorize, createCheckpointM, removeCheckpointM } =
    useTransactionsMutations({ setDeletingTx, setDeleteError, setConfirmBulkDelete, setBulkDeleteError, setSelectedIds, setBulkSelectValue, setBulkCategorizeError, setBulkCategorizeNotice, setCheckpointError, setPendingCheckpointDate });

  const accounts = accountsQ.data?.accounts ?? [];
  const categories = categoriesQ.data?.categories ?? [];
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c] as const)), [categories]);
  const sortedCategories = useMemo(
    () => sortCategoriesForPicker(categories, catById),
    [categories, catById],
  );
  const deferredDelete = useDeferredDelete();
  const txs = useMemo(() => txQ.data?.transactions ?? [], [txQ.data]);
  // Rows sitting in the undo window read as already deleted.
  const visibleTxs = useMemo(
    () => txs.filter((tx) => !deferredDelete.hiddenIds.has(tx.id)),
    [txs, deferredDelete.hiddenIds],
  );
  const total = txQ.data?.pagination.total ?? 0;

  const accountById = new Map(accounts.map((a) => [a.id, a] as const));

  const searchInputRef = useRef<HTMLInputElement>(null);
  const { cursorId } = useTransactionShortcuts({
    rows: visibleTxs,
    // Inert while any modal/dialog is open — typing guards live in the hook.
    disabled: modalTx !== undefined || deletingTx !== null || confirmBulkDelete,
    onEdit: (tx) => setModalTx(tx),
    onDelete: (tx) => {
      setDeleteError(null);
      setDeletingTx(tx);
    },
    focusSearch: () => searchInputRef.current?.focus(),
  });

  const { checkpointByDate, onToggleCheckpoint } = useCheckpoints({
    accountId: filters.accountId,
    createCheckpointM,
    removeCheckpointM,
    setPendingCheckpointDate,
  });

  // Row-action handlers shared by the desktop table AND the mobile view.
  // Hoisted so both branches reference the same stable callbacks instead
  // of allocating equivalent arrows in JSX.
  const onUpdateCategory = (id: number, patch: { categoryId: number | null }) =>
    updateCategory.mutate({ id, ...patch });
  const onUpdateNotes = (id: number, patch: { notes: string | null }) =>
    updateNotes.mutate({ id, ...patch });
  const onEditTx = (tx: Transaction) => setModalTx(tx);
  const onDeleteTx = (tx: Transaction) => { setDeleteError(null); setDeletingTx(tx); };

  return (
    <div className="flex flex-col gap-6">
      <TransactionsHeader
        total={total}
        filters={filters}
        showFilters={showFilters}
        onToggleFilters={() => setShowFilters((s) => !s)}
        onNewTransaction={() => setModalTx(null)}
      />

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
          searchInputRef={searchInputRef}
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
      ) : isMobile ? (
        <TransactionsMobileView
          transactions={visibleTxs}
          accountById={accountById}
          catById={catById}
          sortedCategories={sortedCategories}
          isLoading={txQ.isLoading}
          onUpdateCategory={onUpdateCategory}
          onUpdateNotes={onUpdateNotes}
          onAdvancedEdit={onEditTx}
          onDelete={onDeleteTx}
        />
      ) : (
        <TransactionsTable
          transactions={visibleTxs}
          sortedCategories={sortedCategories}
          catById={catById}
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
          onToggleSelectAll={(checked) =>
            setSelectedIds((s) => toggleAllInSet(s, visibleTxs.map((tx) => tx.id), checked))
          }
          onUpdateCategory={onUpdateCategory}
          onUpdateNotes={onUpdateNotes}
          expandedIds={expandedIds}
          onToggleExpanded={(id) => setExpandedIds((s) => toggleInSet(s, id, !s.has(id)))}
          onEdit={onEditTx}
          onDelete={onDeleteTx}
          firstRowRef={rowAnchor}
          multiSelectRef={multiAnchor}
          cursorId={cursorId}
        />
      )}

      <p className="hidden md:block text-[11px] text-ink-600">{t('shortcutsHint')}</p>

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
        onConfirmDelete={() => {
          if (!deletingTx) return;
          const id = deletingTx.id;
          setDeletingTx(null);
          deferredDelete.begin([id], 'single', () => deleteTransaction.mutate(id));
        }}
        onCancelDelete={() => { setDeletingTx(null); setDeleteError(null); }}
        confirmBulkDelete={confirmBulkDelete}
        bulkDeleteCount={selectedIds.size}
        bulkDeleteError={bulkDeleteError}
        isBulkDeleting={bulkDelete.isPending}
        onConfirmBulkDelete={() => {
          const ids = Array.from(selectedIds);
          setConfirmBulkDelete(false);
          setSelectedIds(new Set());
          deferredDelete.begin(ids, 'bulk', () => bulkDelete.mutate(ids));
        }}
        onCancelBulkDelete={() => { setConfirmBulkDelete(false); setBulkDeleteError(null); }}
      />

      {deferredDelete.pending && (
        <UndoToast pending={deferredDelete.pending} onUndo={deferredDelete.undo} />
      )}
    </div>
  );
}
