import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSettings } from '../useSettings';
import { DEFAULTS } from '../settings';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../api/client';
const apiMock = vi.mocked(api);

function wrap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => { apiMock.mockReset(); });

describe('useSettings', () => {
  it('returns DEFAULTS while the query is pending', async () => {
    let resolveQuery: (v: unknown) => void = () => {};
    apiMock.mockImplementation(() => new Promise((res) => { resolveQuery = res; }));
    const { result } = renderHook(() => useSettings(), { wrapper: wrap() });
    expect(result.current.settings).toEqual(DEFAULTS);
    expect(result.current.isReady).toBe(false);
    resolveQuery({ settings: { ...DEFAULTS, dashboardRange: '12m' } });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.settings.dashboardRange).toBe('12m');
  });

  it('applies optimistic update immediately', async () => {
    let resolvePatch: (v: unknown) => void = () => {};
    apiMock.mockImplementation((_path: string, init?: any) => {
      if (init?.method === 'PATCH') return new Promise((res) => { resolvePatch = res; });
      return Promise.resolve({ settings: DEFAULTS });
    });
    const { result } = renderHook(() => useSettings(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    act(() => result.current.patch({ dashboardRange: '6m' }));
    // The optimistic update happens synchronously inside onMutate.
    await waitFor(() => expect(result.current.settings.dashboardRange).toBe('6m'));
    resolvePatch({ settings: { ...DEFAULTS, dashboardRange: '6m' } });
  });

  it('rolls back on mutation error', async () => {
    let rejectPatch: (e: unknown) => void = () => {};
    apiMock.mockImplementation((_path: string, init?: any) => {
      if (init?.method === 'PATCH') return new Promise((_res, rej) => { rejectPatch = rej; });
      return Promise.resolve({ settings: DEFAULTS });
    });
    const { result } = renderHook(() => useSettings(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    act(() => result.current.patch({ dashboardRange: '6m' }));
    await waitFor(() => expect(result.current.settings.dashboardRange).toBe('6m'));
    rejectPatch(new Error('boom'));
    await waitFor(() => expect(result.current.settings.dashboardRange).toBe(DEFAULTS.dashboardRange));
  });

  it('optimistic update deep-merges notifications sub-tree (regression: Alerts tab black screen)', async () => {
    // Regression for: committing a threshold on the Alerts tab wiped out
    // sibling notification fields (channels/privacy/other triggers) via a
    // shallow spread, then NotificationsTriggersCard threw on
    // `triggers.accountLow.enabled` — no ErrorBoundary → black screen.
    apiMock.mockImplementation((_path: string, init?: any) => {
      // Never resolves: we want to observe the optimistic state, not the
      // eventual refetch's server-merged state.
      if (init?.method === 'PATCH') return new Promise(() => {});
      return Promise.resolve({ settings: DEFAULTS });
    });
    const { result } = renderHook(() => useSettings(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    act(() => result.current.patch({
      notifications: { triggers: { bigTransaction: { thresholds: { '3': 150.5 } } } },
    }));
    await waitFor(() => {
      expect(result.current.settings.notifications.triggers.bigTransaction.thresholds).toEqual({ '3': 150.5 });
    });
    const n = result.current.settings.notifications;
    expect(n.enabled).toBe(DEFAULTS.notifications.enabled);
    expect(n.channels).toEqual(DEFAULTS.notifications.channels);
    expect(n.privacy).toEqual(DEFAULTS.notifications.privacy);
    expect(n.triggers.bigTransaction.enabled).toBe(DEFAULTS.notifications.triggers.bigTransaction.enabled);
    expect(n.triggers.accountLow).toEqual(DEFAULTS.notifications.triggers.accountLow);
    expect(n.triggers.envelopeExceeded).toEqual(DEFAULTS.notifications.triggers.envelopeExceeded);
    expect(n.triggers.bankSyncFailed).toEqual(DEFAULTS.notifications.triggers.bankSyncFailed);
  });

  it('invalidates on settle so a fresh GET is refetched', async () => {
    apiMock.mockImplementation((_path: string, init?: any) => {
      if (init?.method === 'PATCH') return Promise.resolve({ settings: { ...DEFAULTS, dashboardRange: '6m' } });
      return Promise.resolve({ settings: DEFAULTS });
    });
    const { result } = renderHook(() => useSettings(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    apiMock.mockClear();
    apiMock.mockImplementation((_path: string, init?: any) => {
      if (init?.method === 'PATCH') return Promise.resolve({ settings: { ...DEFAULTS, dashboardRange: '6m' } });
      return Promise.resolve({ settings: { ...DEFAULTS, dashboardRange: '6m' } });
    });
    act(() => result.current.patch({ dashboardRange: '6m' }));
    // Wait deterministically for the mutation to settle before asserting the refetch.
    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
    // On settle → invalidate → refetch → GET runs again.
    await waitFor(() => {
      const gets = apiMock.mock.calls.filter(([, init]) => (init as any)?.method !== 'PATCH');
      expect(gets.length).toBeGreaterThanOrEqual(1);
    });
  });
});
