import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Budget, BudgetReport } from '../api/types';

export function useBudgets() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['budgets'] });
    qc.invalidateQueries({ queryKey: ['budget-report'] });
  };

  const query = useQuery({
    queryKey: ['budgets'],
    queryFn: () => api<{ budgets: Budget[] }>('/api/budgets'),
  });

  const create = useMutation({
    mutationFn: (body: { categoryId: number; monthlyLimit: string; currency?: string }) =>
      api<{ budget: Budget }>('/api/budgets', { method: 'POST', json: body }),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: (args: { id: number; monthlyLimit?: string; currency?: string }) =>
      api<{ budget: Budget }>(`/api/budgets/${args.id}`, {
        method: 'PUT',
        json: { monthlyLimit: args.monthlyLimit, currency: args.currency },
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api<null>(`/api/budgets/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  return { budgets: query.data?.budgets ?? [], isLoading: query.isLoading, create, update, remove };
}

export function useBudgetReport(month: string) {
  return useQuery({
    queryKey: ['budget-report', month],
    queryFn: () => api<BudgetReport>('/api/reports/budget', { query: { month } }),
  });
}
