import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Transaction } from '../../api/types';
import { createCheckpoint, deleteCheckpoint } from '../../api/checkpoints';

type Callbacks = {
  setDeletingTx: (v: Transaction | null) => void;
  setDeleteError: (v: string | null) => void;
  setConfirmBulkDelete: (v: boolean) => void;
  setBulkDeleteError: (v: string | null) => void;
  setSelectedIds: (v: Set<number>) => void;
  setBulkSelectValue: (v: string) => void;
  setBulkCategorizeError: (v: string | null) => void;
  setBulkCategorizeNotice: (v: { skipped: number } | null) => void;
  setCheckpointError: (v: string | null) => void;
  setPendingCheckpointDate: (v: string | null) => void;
};

export function useTransactionsMutations(cb: Callbacks) {
  const qc = useQueryClient();

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
      cb.setDeletingTx(null);
      cb.setDeleteError(null);
    },
    onError: (err: ApiError) => cb.setDeleteError(err.message),
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
      cb.setConfirmBulkDelete(false);
      cb.setBulkDeleteError(null);
      cb.setSelectedIds(new Set());
    },
    onError: (err: ApiError) => cb.setBulkDeleteError(err.message),
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
      cb.setSelectedIds(new Set());
      cb.setBulkSelectValue('');
      cb.setBulkCategorizeError(null);
      cb.setBulkCategorizeNotice(skipped > 0 ? { skipped } : null);
    },
    onError: (err: ApiError) => {
      cb.setBulkSelectValue('');
      cb.setBulkCategorizeError(err.message);
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
      cb.setCheckpointError(null);
    },
    onError: (err: ApiError) => cb.setCheckpointError(err.message),
    onSettled: () => cb.setPendingCheckpointDate(null),
  });

  const removeCheckpointM = useMutation({
    mutationFn: (vars: { accountId: number; cpId: number }) =>
      deleteCheckpoint(vars.accountId, vars.cpId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balance-checkpoints'] });
      cb.setCheckpointError(null);
    },
    onError: (err: ApiError) => cb.setCheckpointError(err.message),
    onSettled: () => cb.setPendingCheckpointDate(null),
  });

  return {
    updateCategory,
    updateNotes,
    deleteTransaction,
    bulkDelete,
    bulkCategorize,
    createCheckpointM,
    removeCheckpointM,
  };
}
