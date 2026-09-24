import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Account } from '../../api/types';
import type { AccountFormValues } from './AccountForm';

// Owns the three write-path mutations on the Accounts page plus their
// error slots. Keeps Accounts/index focused on layout + drag + tour.
export function useAccountsMutations() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (input: AccountFormValues) =>
      api<{ account: Account }>('/api/accounts', { method: 'POST', json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: (err: ApiError) => setError(err.message),
  });

  const updateAccount = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Account> }) =>
      api<{ account: Account }>(`/api/accounts/${id}`, { method: 'PUT', json: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: (err: ApiError) => setEditError(err.message),
  });

  const del = useMutation({
    mutationFn: (id: number) => api(`/api/accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      setDeleteError(null);
    },
    onError: (err: ApiError) => {
      // Backend returns 409 with a clear message when the account has
      // transactions; surface that text inside the dialog instead of letting
      // the dialog close silently.
      setDeleteError(err.message);
    },
  });

  return { create, updateAccount, del, error, setError, editError, setEditError, deleteError, setDeleteError };
}
