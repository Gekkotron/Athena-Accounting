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

// Module-frozen empty arrays for the `xxxQ.data ?? []` fallback pattern.
// A fresh `[]` allocated per render before the query settles invalidates
// every downstream useMemo dep — call sites use these constants instead
// (`accountsQ.data ?? EMPTY_ACCOUNTS`) so the reference stays stable
// across the loading→loaded transition. Safe to freeze because consumers
// only read via .map/.filter/etc.
export const EMPTY_ACCOUNTS: Account[] = Object.freeze([]) as unknown as Account[];
export const EMPTY_CATEGORIES: Category[] = Object.freeze([]) as unknown as Category[];
export const EMPTY_PATTERNS: AccountFilenamePattern[] = Object.freeze([]) as unknown as AccountFilenamePattern[];
export const EMPTY_RULES: Rule[] = Object.freeze([]) as unknown as Rule[];

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

