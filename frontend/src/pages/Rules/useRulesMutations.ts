import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { MatchMode, Rule, SignConstraint } from '../../api/types';

// Owns the four write-path mutations on the Rules page plus the delete
// error slot. Keeping them here lets the page stay focused on layout +
// view selection.
export function useRulesMutations() {
  const qc = useQueryClient();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const createBatch = useMutation({
    mutationFn: async (input: {
      keywords: string[];
      categoryId: number;
      signConstraint: SignConstraint;
      matchMode: MatchMode;
      priority: number;
      splits?: Array<{ categoryId: number; percent: number }>;
    }) => {
      await Promise.all(
        input.keywords.map((kw) =>
          api('/api/rules', {
            method: 'POST',
            json: {
              keyword: kw,
              categoryId: input.categoryId,
              signConstraint: input.signConstraint,
              matchMode: input.matchMode,
              priority: input.priority,
              ...(input.splits ? { splits: input.splits } : {}),
            },
          }),
        ),
      );
      return input.keywords.length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rules'] });
    },
  });

  const updateRule = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Rule> }) =>
      api(`/api/rules/${id}`, { method: 'PUT', json: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });

  const del = useMutation({
    mutationFn: (id: number) => api(`/api/rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rules'] });
      setDeleteError(null);
    },
    onError: (err: ApiError) => setDeleteError(err.message),
  });

  const recategorize = useMutation({
    mutationFn: () =>
      api<{ total: number; recategorized: number; unknown: number; preserved: number }>(
        '/api/recategorize',
        { method: 'POST', json: { preserveManual: true } },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['tri-groups'] });
    },
  });

  return { createBatch, updateRule, del, recategorize, deleteError, setDeleteError };
}
