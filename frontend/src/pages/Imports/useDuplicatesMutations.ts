import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';

type Callbacks = {
  setConfirmDeleteTxId: (v: number | null) => void;
  setDupDeleteError: (v: string | null) => void;
  setSelectedIds: (v: Set<number>) => void;
  setBulkError: (v: string | null) => void;
};

export function useDuplicatesMutations(cb: Callbacks) {
  const qc = useQueryClient();

  // Mark every row in a doublons group as "not a duplicate". The group then
  // disappears from the panel because BOOL_OR(NOT not_duplicate) goes false.
  // If a NEW row with the same (account, date, amount) shows up later, the
  // group re-appears so the user can re-evaluate.
  const markNotDuplicateMut = useMutation({
    mutationFn: (ids: number[]) =>
      api<{ updated: number }>('/api/transactions/mark-not-duplicate', {
        method: 'POST',
        json: { ids },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transaction-duplicates'] });
    },
  });

  const deleteTxMut = useMutation({
    mutationFn: (id: number) =>
      api<{ ok: true }>(`/api/transactions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transaction-duplicates'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['tri-groups'] });
      cb.setConfirmDeleteTxId(null);
      cb.setDupDeleteError(null);
    },
    onError: (err: ApiError) => cb.setDupDeleteError(err.message),
  });

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: number[]) =>
      api<{ deleted: number }>('/api/transactions/delete-bulk', {
        method: 'POST',
        json: { ids },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transaction-duplicates'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['tri-groups'] });
      cb.setSelectedIds(new Set());
      cb.setBulkError(null);
    },
    onError: (err: ApiError) => cb.setBulkError(err.message),
  });

  const bulkMarkNotDupMut = useMutation({
    mutationFn: (ids: number[]) =>
      api<{ updated: number }>('/api/transactions/mark-not-duplicate', {
        method: 'POST',
        json: { ids },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transaction-duplicates'] });
      cb.setSelectedIds(new Set());
      cb.setBulkError(null);
    },
    onError: (err: ApiError) => cb.setBulkError(err.message),
  });

  return { markNotDuplicateMut, deleteTxMut, bulkDeleteMut, bulkMarkNotDupMut };
}
