import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Account, AccountFilenamePattern } from '../../api/types';
import { PatternsSection } from './PatternsSection';

export function Patterns(): JSX.Element {
  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const patternsQ = useQuery({
    queryKey: ['patterns'],
    queryFn: () => api<{ patterns: AccountFilenamePattern[] }>('/api/account-filename-patterns'),
  });

  return (
    <PatternsSection
      accounts={accountsQ.data?.accounts ?? []}
      patterns={patternsQ.data?.patterns ?? []}
    />
  );
}
