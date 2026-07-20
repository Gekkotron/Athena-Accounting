import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TipsProvider, useTips } from '../TipsContext';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const wrapper = ({ children }: { children: ReactNode }) => (
  <TipsProvider>{children}</TipsProvider>
);

beforeEach(() => {
  fetchMock.mockReset();
});

describe('TipsProvider', () => {
  it('hydrates dismissed ids on mount and exposes ready=true', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ dismissed: { 'tour:dashboard': '2026-07-16T00:00:00.000Z' } }),
    });
    const { result } = renderHook(() => useTips(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.isDismissed('tour:dashboard')).toBe(true);
    expect(result.current.isDismissed('tour:accounts')).toBe(false);
  });

  it('dismiss() optimistically updates then POSTs', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ dismissed: {} }) })
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' });
    const { result } = renderHook(() => useTips(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.dismiss('tour:budgets');
    });
    expect(result.current.isDismissed('tour:budgets')).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/tips/dismiss',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('dismiss() rolls back on server error', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ dismissed: {} }) })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => JSON.stringify({}) });
    const { result } = renderHook(() => useTips(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await expect(result.current.dismiss('tour:dashboard')).rejects.toBeTruthy();
    });
    expect(result.current.isDismissed('tour:dashboard')).toBe(false);
  });

  it('reset() clears state and POSTs /reset', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true, status: 200,
        text: async () => JSON.stringify({ dismissed: { 'tour:dashboard': 'x', 'tour:budgets': 'y' } }),
      })
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' });
    const { result } = renderHook(() => useTips(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.reset();
    });
    expect(result.current.dismissed).toEqual({});
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/tips/reset',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('useTips() throws when used outside provider', () => {
    // Suppress the expected error boundary noise.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useTips())).toThrow(/TipsProvider/);
    err.mockRestore();
  });
});
