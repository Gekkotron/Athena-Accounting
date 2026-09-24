import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Category, CategoryKind } from '../../api/types';

// Owns the three write-path mutations on the Categories page plus the
// two error slots. Kept together because they share the setError/setName
// reset semantics and the same invalidate targets on success.
export function useCategoriesMutations() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (input: {
      name: string;
      kind: CategoryKind;
      color: string | null;
      parentId: number | null;
    }) => api<{ category: Category }>('/api/categories', { method: 'POST', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
    onError: (err: ApiError) => setError(err.message),
  });

  const updateCategory = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Category> }) =>
      api(`/api/categories/${id}`, { method: 'PUT', json: patch }),
    onMutate: async ({ id, patch }) => {
      // Only take a snapshot when the mutation touches parentId — that's the
      // path drag-and-drop uses; other patches are covered by the standard
      // invalidate-on-success and don't need optimistic rewriting.
      if (!Object.prototype.hasOwnProperty.call(patch, 'parentId')) return;
      await qc.cancelQueries({ queryKey: ['categories'] });
      const previous = qc.getQueryData<{ categories: Category[] }>(['categories']);
      if (previous) {
        const next = {
          categories: previous.categories.map((c) =>
            c.id === id ? { ...c, parentId: patch.parentId ?? null } : c,
          ),
        };
        qc.setQueryData(['categories'], next);
      }
      return { previous } as const;
    },
    onError: (err: ApiError, _vars, context) => {
      if (context?.previous) qc.setQueryData(['categories'], context.previous);
      setError(err.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });

  const del = useMutation({
    mutationFn: (id: number) => api(`/api/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['rules'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      setDeleteError(null);
    },
    onError: (err: ApiError) => setDeleteError(err.message),
  });

  return { error, setError, deleteError, setDeleteError, create, updateCategory, del };
}
