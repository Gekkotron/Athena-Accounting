import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

// Single source of truth for the "attention needed" badges that appear both
// on left-nav items (NavTree) and on their in-page tabs (HubLayout). Keyed
// by the tab's route path — the two renderers just look up `badges[to]`.
// The React Query cache dedupes the underlying request across both consumers.
export function useNavBadgeCounts(): Record<string, number> {
  const duplicates = useQuery({
    queryKey: ['transaction-duplicates'],
    queryFn: () => api<{ groups: unknown[] }>('/api/transactions/duplicates'),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
  return {
    '/data/duplicates': duplicates.data?.groups?.length ?? 0,
  };
}
