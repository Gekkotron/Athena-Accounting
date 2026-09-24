import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  listGoals, getGoal, createGoal, updateGoal, closeGoal,
  reopenGoal, deleteGoal, listGoalEvents, createGoalEvent,
  updateGoalEvent, deleteGoalEvent,
} from '../goals';

const originalFetch = globalThis.fetch;

interface Call { url: string; method: string; body: string | null; }

function mockFetch(response: unknown, status = 200) {
  const calls: Call[] = [];
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: typeof input === 'string' ? input : input.toString(),
      method: (init?.method ?? 'GET').toUpperCase(),
      body: (init?.body as string | null) ?? null,
    });
    return Promise.resolve(new Response(JSON.stringify(response), {
      status, headers: { 'Content-Type': 'application/json' },
    }));
  });
  globalThis.fetch = fn as unknown as typeof globalThis.fetch;
  return calls;
}

afterEach(() => { globalThis.fetch = originalFetch; });

describe('goals API — reads', () => {
  it('listGoals() by default omits includeClosed from the query', async () => {
    const calls = mockFetch({ goals: [], perAccount: {} });
    await listGoals();
    // client.ts skips empty-value query params, so the URL has no ?includeClosed.
    expect(calls[0]!.url).toBe('/api/goals');
    expect(calls[0]!.method).toBe('GET');
  });

  it('listGoals(true) includes includeClosed=1', async () => {
    const calls = mockFetch({ goals: [], perAccount: {} });
    await listGoals(true);
    expect(calls[0]!.url).toBe('/api/goals?includeClosed=1');
  });

  it('getGoal(id) hits /api/goals/:id', async () => {
    const calls = mockFetch({ goal: { id: 7 } });
    const r = await getGoal(7);
    expect(calls[0]!.url).toBe('/api/goals/7');
    expect(calls[0]!.method).toBe('GET');
    expect(r.goal.id).toBe(7);
  });

  it('listGoalEvents(id) with no opts → no query string', async () => {
    const calls = mockFetch({ events: [] });
    await listGoalEvents(3);
    expect(calls[0]!.url).toBe('/api/goals/3/events');
  });

  it('listGoalEvents(id, {limit, before}) serialises both params', async () => {
    const calls = mockFetch({ events: [] });
    await listGoalEvents(3, { limit: 20, before: 999 });
    // Order isn't specified — assert on membership.
    const url = new URL(calls[0]!.url, 'http://x/');
    expect(url.pathname).toBe('/api/goals/3/events');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.get('before')).toBe('999');
  });

  it('listGoalEvents(id, {limit: 0}) still serialises the 0 (limit != null)', async () => {
    const calls = mockFetch({ events: [] });
    await listGoalEvents(3, { limit: 0 });
    const url = new URL(calls[0]!.url, 'http://x/');
    expect(url.searchParams.get('limit')).toBe('0');
  });
});

describe('goals API — writes', () => {
  it('createGoal POSTs body to /api/goals', async () => {
    const calls = mockFetch({ goal: { id: 1 } });
    const body = { accountId: 5, name: 'Vacation', targetAmount: '1000.00', targetDate: '2027-01-01', color: '#abcdef' };
    await createGoal(body);
    expect(calls[0]!.url).toBe('/api/goals');
    expect(calls[0]!.method).toBe('POST');
    expect(JSON.parse(calls[0]!.body!)).toEqual(body);
  });

  it('updateGoal PUTs patch to /api/goals/:id', async () => {
    const calls = mockFetch({ goal: { id: 2 } });
    await updateGoal(2, { name: 'Renamed', targetAmount: '500.00' });
    expect(calls[0]!.url).toBe('/api/goals/2');
    expect(calls[0]!.method).toBe('PUT');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ name: 'Renamed', targetAmount: '500.00' });
  });

  it('closeGoal / reopenGoal / deleteGoal hit the right verbs', async () => {
    const closed = mockFetch({ goal: { id: 3 } });
    await closeGoal(3);
    expect(closed[0]!.url).toBe('/api/goals/3/close');
    expect(closed[0]!.method).toBe('POST');

    const reopened = mockFetch({ goal: { id: 3 } });
    await reopenGoal(3);
    expect(reopened[0]!.url).toBe('/api/goals/3/reopen');
    expect(reopened[0]!.method).toBe('POST');

    const del = mockFetch({ ok: true });
    await deleteGoal(3);
    expect(del[0]!.url).toBe('/api/goals/3');
    expect(del[0]!.method).toBe('DELETE');
  });

  it('createGoalEvent POSTs to /api/goals/:goalId/events', async () => {
    const calls = mockFetch({ event: { id: 4 }, justReached: false });
    await createGoalEvent(11, { amount: '50.00', eventDate: '2026-05-01', note: 'first deposit' });
    expect(calls[0]!.url).toBe('/api/goals/11/events');
    expect(calls[0]!.method).toBe('POST');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ amount: '50.00', eventDate: '2026-05-01', note: 'first deposit' });
  });

  it('updateGoalEvent PUTs to /api/goals/:goalId/events/:eventId', async () => {
    const calls = mockFetch({ event: { id: 4 } });
    await updateGoalEvent(11, 4, { amount: '75.00' });
    expect(calls[0]!.url).toBe('/api/goals/11/events/4');
    expect(calls[0]!.method).toBe('PUT');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ amount: '75.00' });
  });

  it('deleteGoalEvent DELETEs the event URL', async () => {
    const calls = mockFetch({ ok: true });
    await deleteGoalEvent(11, 4);
    expect(calls[0]!.url).toBe('/api/goals/11/events/4');
    expect(calls[0]!.method).toBe('DELETE');
  });
});
