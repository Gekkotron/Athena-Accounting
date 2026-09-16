import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Account, AccountFilenamePattern, Category, Rule } from '../api/types';

// Reference data (accounts, categories, patterns, rules) is effectively
// immutable per session — mutations invalidate the cache anyway. Bumping
// staleTime past the default 30 s stops the ~15 useQuery sites that share
// each key from refetching every time a component remounts, and `select`
// unwraps the envelope so React Query's structural sharing can return the
// same array reference across refetches (which lets downstream useMemo /
// React.memo actually skip work).
export const REFERENCE_STALE_TIME_MS = 5 * 60 * 1000;

export function useAccounts(): UseQueryResult<Account[]> {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
    staleTime: REFERENCE_STALE_TIME_MS,
    select: (d) => d.accounts,
  });
}

export function useCategories(): UseQueryResult<Category[]> {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
    staleTime: REFERENCE_STALE_TIME_MS,
    select: (d) => d.categories,
  });
}

export function useAccountPatterns(): UseQueryResult<AccountFilenamePattern[]> {
  return useQuery({
    queryKey: ['patterns'],
    queryFn: () => api<{ patterns: AccountFilenamePattern[] }>('/api/account-filename-patterns'),
    staleTime: REFERENCE_STALE_TIME_MS,
    select: (d) => d.patterns,
  });
}

export function useRules(): UseQueryResult<Rule[]> {
  return useQuery({
    queryKey: ['rules'],
    queryFn: () => api<{ rules: Rule[] }>('/api/rules'),
    staleTime: REFERENCE_STALE_TIME_MS,
    select: (d) => d.rules,
  });
}
