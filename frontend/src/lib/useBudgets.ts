import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Budget, BudgetReport, BudgetPeriod } from '../api/types';

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
    mutationFn: (body: {
      categoryId: number; monthlyLimit: string; currency?: string;
      period?: BudgetPeriod; accountId?: number | null;
    }) => api<{ budget: Budget }>('/api/budgets', { method: 'POST', json: body }),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: (args: {
      id: number; monthlyLimit?: string; currency?: string;
      period?: BudgetPeriod; accountId?: number | null;
    }) => api<{ budget: Budget }>(`/api/budgets/${args.id}`, {
      method: 'PUT',
      json: {
        monthlyLimit: args.monthlyLimit,
        currency: args.currency,
        period: args.period,
        accountId: args.accountId,
      },
    }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api<null>(`/api/budgets/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  return { budgets: query.data?.budgets ?? [], isLoading: query.isLoading, create, update, remove };
}

export function useBudgetReport(args: {
  period: BudgetPeriod;
  month?: string;
  year?: string;
  accountId?: number | null;
}) {
  const query: Record<string, string | number> = { period: args.period };
  if (args.period === 'monthly' && args.month) query.month = args.month;
  if (args.period === 'yearly' && args.year) query.year = args.year;
  if (args.accountId != null) query.accountId = args.accountId;

  return useQuery({
    queryKey: ['budget-report', args.period, args.month, args.year, args.accountId ?? null],
    queryFn: () => api<BudgetReport>('/api/reports/budget', { query }),
  });
}
