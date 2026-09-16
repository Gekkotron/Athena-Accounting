import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useAccounts,
  useCategories,
  useAccountPatterns,
  useRules,
  REFERENCE_STALE_TIME_MS,
} from '../useReferenceData';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../api/client';
const apiMock = vi.mocked(api);

function wrap(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => { apiMock.mockReset(); });

describe('useReferenceData hooks', () => {
  it('REFERENCE_STALE_TIME_MS is at least 5 minutes', () => {
    expect(REFERENCE_STALE_TIME_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });

  it('useAccounts unwraps the accounts array via select', async () => {
    apiMock.mockResolvedValueOnce({ accounts: [{ id: 1, name: 'Livret' }] });
    const client = newClient();
    const { result } = renderHook(() => useAccounts(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.data).toEqual([{ id: 1, name: 'Livret' }]));
    expect(apiMock).toHaveBeenCalledWith('/api/accounts');
  });

  it('useCategories unwraps the categories array', async () => {
    apiMock.mockResolvedValueOnce({ categories: [{ id: 7, name: 'Alim' }] });
    const client = newClient();
    const { result } = renderHook(() => useCategories(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.data).toEqual([{ id: 7, name: 'Alim' }]));
  });

  it('useAccountPatterns hits /api/account-filename-patterns and unwraps patterns', async () => {
    apiMock.mockResolvedValueOnce({ patterns: [{ id: 3, pattern: 'foo' }] });
    const client = newClient();
    const { result } = renderHook(() => useAccountPatterns(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.data).toEqual([{ id: 3, pattern: 'foo' }]));
    expect(apiMock).toHaveBeenCalledWith('/api/account-filename-patterns');
  });

  it('useRules unwraps rules', async () => {
    apiMock.mockResolvedValueOnce({ rules: [{ id: 42, categoryId: 1 }] });
    const client = newClient();
    const { result } = renderHook(() => useRules(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.data).toEqual([{ id: 42, categoryId: 1 }]));
  });

  it('staleTime prevents refetch within the window; invalidateQueries forces one', async () => {
    apiMock.mockResolvedValue({ accounts: [{ id: 1, name: 'A' }] });
    const client = newClient();
    const { result, rerender } = renderHook(() => useAccounts(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.data).toEqual([{ id: 1, name: 'A' }]));
    expect(apiMock).toHaveBeenCalledTimes(1);

    rerender();
    expect(apiMock).toHaveBeenCalledTimes(1);

    apiMock.mockResolvedValueOnce({ accounts: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] });
    await act(async () => { await client.invalidateQueries({ queryKey: ['accounts'] }); });
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.data).toHaveLength(2));
  });

  it('structural sharing returns the same reference when payload is unchanged', async () => {
    const payload = { accounts: [{ id: 1, name: 'A' }] };
    apiMock.mockResolvedValue(payload);
    const client = newClient();
    const { result } = renderHook(() => useAccounts(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const firstRef = result.current.data;

    apiMock.mockResolvedValueOnce({ accounts: [{ id: 1, name: 'A' }] });
    await act(async () => { await client.invalidateQueries({ queryKey: ['accounts'] }); });
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));

    expect(result.current.data).toBe(firstRef);
  });
});
