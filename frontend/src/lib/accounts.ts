import type { Account } from '../api/types';

export function getAccountName(accounts: Account[], id: number): string {
  return accounts.find((a) => a.id === id)?.name ?? `#${id}`;
}
