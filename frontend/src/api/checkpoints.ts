import { api } from './client';
import type { BalanceCheckpoint } from './types';

export function listCheckpoints(accountId: number) {
  return api<{ checkpoints: BalanceCheckpoint[] }>(
    `/api/accounts/${accountId}/balance-checkpoints`,
  );
}

export function createCheckpoint(
  accountId: number,
  body: { checkpointDate: string; expectedAmount: string; note?: string | null },
) {
  return api<{ checkpoint: BalanceCheckpoint }>(
    `/api/accounts/${accountId}/balance-checkpoints`,
    { method: 'POST', json: body },
  );
}

export function updateCheckpoint(
  accountId: number,
  cpId: number,
  patch: { expectedAmount?: string; note?: string | null },
) {
  return api<{ checkpoint: BalanceCheckpoint }>(
    `/api/accounts/${accountId}/balance-checkpoints/${cpId}`,
    { method: 'PUT', json: patch },
  );
}

export function deleteCheckpoint(accountId: number, cpId: number) {
  return api<void>(`/api/accounts/${accountId}/balance-checkpoints/${cpId}`, {
    method: 'DELETE',
  });
}
