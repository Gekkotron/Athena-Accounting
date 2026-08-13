import { api } from './client';
import type { SavingsGoal, SavingsGoalEvent } from './types';

export interface GoalsListResponse {
  goals: SavingsGoal[];
  perAccount: Record<number, { savedSum: string }>;
}

export function listGoals(includeClosed = false) {
  return api<GoalsListResponse>('/api/goals', {
    query: includeClosed ? { includeClosed: '1' } : {},
  });
}

export function getGoal(id: number) {
  return api<{ goal: SavingsGoal }>(`/api/goals/${id}`);
}

export function createGoal(body: {
  accountId: number;
  name: string;
  targetAmount: string;
  targetDate?: string | null;
  color?: string | null;
}) {
  return api<{ goal: SavingsGoal }>('/api/goals', { method: 'POST', json: body });
}

export function updateGoal(
  id: number,
  patch: {
    name?: string;
    targetAmount?: string;
    targetDate?: string | null;
    color?: string | null;
  },
) {
  return api<{ goal: SavingsGoal }>(`/api/goals/${id}`, { method: 'PUT', json: patch });
}

export function closeGoal(id: number) {
  return api<{ goal: SavingsGoal }>(`/api/goals/${id}/close`, { method: 'POST' });
}

export function reopenGoal(id: number) {
  return api<{ goal: SavingsGoal }>(`/api/goals/${id}/reopen`, { method: 'POST' });
}

export function deleteGoal(id: number) {
  return api<{ ok: true }>(`/api/goals/${id}`, { method: 'DELETE' });
}

export function listGoalEvents(
  goalId: number,
  opts: { limit?: number; before?: number } = {},
) {
  const query: Record<string, string> = {};
  if (opts.limit != null) query.limit = String(opts.limit);
  if (opts.before != null) query.before = String(opts.before);
  return api<{ events: SavingsGoalEvent[] }>(`/api/goals/${goalId}/events`, { query });
}

export function createGoalEvent(
  goalId: number,
  body: { amount: string; eventDate: string; note?: string | null },
) {
  return api<{ event: SavingsGoalEvent; justReached: boolean }>(
    `/api/goals/${goalId}/events`,
    { method: 'POST', json: body },
  );
}

export function updateGoalEvent(
  goalId: number,
  eventId: number,
  patch: { amount?: string; eventDate?: string; note?: string | null },
) {
  return api<{ event: SavingsGoalEvent }>(
    `/api/goals/${goalId}/events/${eventId}`,
    { method: 'PUT', json: patch },
  );
}

export function deleteGoalEvent(goalId: number, eventId: number) {
  return api<{ ok: true }>(`/api/goals/${goalId}/events/${eventId}`, { method: 'DELETE' });
}
