import { api } from './client';

export interface MergeResult {
  transactionsMoved: number;
  dedupCollisionsDropped: number;
  transferGroupsCollapsed: number;
  patternsMoved: number;
  checkpointsMoved: number;
  budgetsMoved: number;
  importsMoved: number;
  templatesMoved: number;
  draftsMoved: number;
  openingBalanceAdded: string;
}

interface MergeResponse {
  ok: true;
  merged: MergeResult;
}

export async function mergeAccount(
  sourceId: number, targetId: number,
): Promise<MergeResult> {
  const res = await api<MergeResponse>(`/api/accounts/${sourceId}/merge`, {
    method: 'POST',
    json: { targetId },
  });
  return res.merged;
}
