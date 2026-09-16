import { useCallback, useEffect, useState } from 'react';
import type { Transaction } from '../../api/types';
import type { Filters } from './filters';
import { parseAmountQuery } from './parseAmountQuery';
import { toggleAllInSet, toggleInSet } from './lib';

// Every page-local piece of state Transactions/index.tsx owns, plus the
// six stable callbacks it derives from that state. Extracted so index.tsx
// stays under the ESLint max-lines cap without hiding what the page is
// actually doing.
export function useTransactionsPageState(initial: { accountId: number | undefined; sourceFileId: number | undefined }) {
  const [filters, setFilters] = useState<Filters>({
    sort: 'date', order: 'desc',
    accountId: initial.accountId, sourceFileId: initial.sourceFileId,
  });
  const [searchInput, setSearchInput] = useState('');
  const [offset, setOffset] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  // null = create; Transaction = edit; undefined = closed.
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
  const onSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    setOffset(0);
    const amt = parseAmountQuery(value);
    if (amt !== null) {
      setFilters((f) => ({ ...f, amount: amt, search: undefined }));
    } else {
      setFilters((f) => ({ ...f, amount: undefined, search: value || undefined }));
    }
  }, []);

  const onEditTx = useCallback((tx: Transaction) => setModalTx(tx), []);
  const onDeleteTx = useCallback((tx: Transaction) => { setDeleteError(null); setDeletingTx(tx); }, []);
  const onToggleSelect = useCallback((id: number, checked: boolean) => setSelectedIds((s) => toggleInSet(s, id, checked)), []);
  const onToggleExpanded = useCallback((id: number) => setExpandedIds((s) => toggleInSet(s, id, !s.has(id))), []);
  // onToggleSelectAll depends on visibleTxs — the caller wraps it via useCallback.
  const makeOnToggleSelectAll = useCallback((visibleTxs: Transaction[]) => (checked: boolean) =>
    setSelectedIds((s) => toggleAllInSet(s, visibleTxs.map((tx) => tx.id), checked)), []);

  return {
    filters, setFilters, searchInput, offset, setOffset,
    showFilters, setShowFilters,
    modalTx, setModalTx,
    deletingTx, setDeletingTx, deleteError, setDeleteError,
    selectedIds, setSelectedIds, expandedIds,
    confirmBulkDelete, setConfirmBulkDelete, bulkDeleteError, setBulkDeleteError,
    bulkSelectValue, setBulkSelectValue,
    bulkCategorizeNotice, setBulkCategorizeNotice,
    bulkCategorizeError, setBulkCategorizeError,
    pendingCheckpointDate, setPendingCheckpointDate,
    checkpointError, setCheckpointError,
    onSearchChange, onEditTx, onDeleteTx, onToggleSelect, onToggleExpanded, makeOnToggleSelectAll,
  };
}
