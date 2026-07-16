import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type {
  EnvelopeAssignment, EnvelopeCategorySettings, EnvelopeHold, EnvelopeReport,
  OverspendPolicy, TargetKind,
} from '../api/types';

const KEY_REPORT = (month: string) => ['envelopes', 'report', month] as const;
const KEY_SETTINGS = ['envelopes', 'settings'] as const;
const KEY_HOLDS = (from: string, to: string) => ['envelopes', 'holds', { from, to }] as const;

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['envelopes'] });
}

export function useEnvelopeReport(month: string) {
  return useQuery({
    queryKey: KEY_REPORT(month),
    queryFn: () => api<EnvelopeReport>('/api/envelopes/report', { query: { month } }),
  });
}

export function useEnvelopeSettings() {
  return useQuery({
    queryKey: KEY_SETTINGS,
    queryFn: () => api<{ settings: EnvelopeCategorySettings[] }>('/api/envelopes/categories'),
  });
}

export function useUpsertAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (json: { categoryId: number; month: string; amount: string; currency?: string }) =>
      api<{ assignment: EnvelopeAssignment }>('/api/envelopes/assignments', {
        method: 'PUT', json,
      }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useReallocate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (json: { fromCategoryId: number; toCategoryId: number; month: string; amount: string }) =>
      api<{ from: EnvelopeAssignment; to: EnvelopeAssignment }>('/api/envelopes/reallocate', {
        method: 'POST', json,
      }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useUpsertHold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (json: { month: string; amount: string }) =>
      api<{ hold?: EnvelopeHold; deleted?: true }>('/api/envelopes/holds', {
        method: 'PUT', json,
      }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useUpsertSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { categoryId: number; body: { targetAmount?: string | null; targetDate?: string | null; targetKind?: TargetKind | null; overspendPolicy?: OverspendPolicy } }) =>
      api<{ settings: EnvelopeCategorySettings }>(`/api/envelopes/categories/${args.categoryId}`, {
        method: 'PUT', json: args.body,
      }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useDeleteSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: number) =>
      api<void>(`/api/envelopes/categories/${categoryId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useHolds(from: string, to: string) {
  return useQuery({
    queryKey: KEY_HOLDS(from, to),
    queryFn: () => api<{ holds: EnvelopeHold[] }>('/api/envelopes/holds', { query: { from, to } }),
  });
}
