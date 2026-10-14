import { api } from './client';
import type { AccountValuation } from '../../../shared/api-contracts';

export type { AccountValuation };

export function listValuations(accountId: number) {
  return api<AccountValuation[]>(`/api/accounts/${accountId}/valuations`);
}

export function upsertValuation(accountId: number, body: { date: string; value: string }) {
  return api<AccountValuation>(`/api/accounts/${accountId}/valuations`, {
    method: 'PUT',
    json: body,
  });
}

export function deleteValuation(accountId: number, valuationId: number) {
  return api<void>(`/api/accounts/${accountId}/valuations/${valuationId}`, {
    method: 'DELETE',
  });
}
