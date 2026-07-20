import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { TourProvider, useTour } from '../TourContext';
import { TipsProvider } from '../TipsContext';

// Wire fetch mock so TipsProvider hydrates to ready=true with no dismissals.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/api/tips/dismissed')) {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ dismissed: {} }),
      } as Response;
    }
    if (url.endsWith('/api/tips/dismiss') || url.endsWith('/api/tips/undismiss')) {
      return { ok: true, status: 200, text: async () => '{}' } as Response;
    }
    return { ok: false, status: 404, text: async () => '{}' } as Response;
  }));
});

function wrap({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={['/']}>
      <TipsProvider>
        <TourProvider>
          <Routes>
            <Route path="*" element={<>{children}</>} />
          </Routes>
        </TourProvider>
      </TipsProvider>
    </MemoryRouter>
  );
}

describe('TourContext', () => {
  it('startTour sets activePageId and resets stepIdx=0', () => {
    const { result } = renderHook(() => useTour(), { wrapper: wrap });
    expect(result.current.activePageId).toBeNull();
    act(() => result.current.startTour('dashboard'));
    expect(result.current.activePageId).toBe('dashboard');
    expect(result.current.stepIdx).toBe(0);
  });

  it('nextStep advances and prevStep steps back; both clamp at bounds', () => {
    const { result } = renderHook(() => useTour(), { wrapper: wrap });
    act(() => result.current.startTour('dashboard')); // 5 steps
    act(() => result.current.nextStep());
    expect(result.current.stepIdx).toBe(1);
    act(() => result.current.prevStep());
    expect(result.current.stepIdx).toBe(0);
    act(() => result.current.prevStep()); // clamp low
    expect(result.current.stepIdx).toBe(0);
    for (let i = 0; i < 10; i++) act(() => result.current.nextStep());
    // last valid stepIdx = TOURS.dashboard.length - 1 = 4; going past finishes.
    expect(result.current.activePageId).toBeNull(); // tour finished, cleared
  });

  it('finishTour dismisses and clears', async () => {
    const fetchSpy = vi.mocked(globalThis.fetch);
    const { result } = renderHook(() => useTour(), { wrapper: wrap });
    act(() => result.current.startTour('accounts'));
    await act(async () => { result.current.finishTour(); });
    expect(result.current.activePageId).toBeNull();
    const dismissCall = fetchSpy.mock.calls.find(([u]) => String(u).endsWith('/api/tips/dismiss'));
    expect(dismissCall).toBeDefined();
    const body = JSON.parse(String((dismissCall![1] as RequestInit).body));
    expect(body).toEqual({ id: 'tour:accounts' });
  });

  it('skipTour dismisses and clears', async () => {
    const fetchSpy = vi.mocked(globalThis.fetch);
    const { result } = renderHook(() => useTour(), { wrapper: wrap });
    act(() => result.current.startTour('imports'));
    await act(async () => { result.current.skipTour(); });
    expect(result.current.activePageId).toBeNull();
    expect(fetchSpy.mock.calls.some(([u]) => String(u).endsWith('/api/tips/dismiss'))).toBe(true);
  });

  it('abortTour clears WITHOUT dismissing', async () => {
    const fetchSpy = vi.mocked(globalThis.fetch);
    fetchSpy.mockClear();
    const { result } = renderHook(() => useTour(), { wrapper: wrap });
    act(() => result.current.startTour('data'));
    act(() => result.current.abortTour());
    expect(result.current.activePageId).toBeNull();
    expect(fetchSpy.mock.calls.some(([u]) => String(u).endsWith('/api/tips/dismiss'))).toBe(false);
  });

  it('starting a new tour while one runs aborts (no persistence)', async () => {
    const fetchSpy = vi.mocked(globalThis.fetch);
    fetchSpy.mockClear();
    const { result } = renderHook(() => useTour(), { wrapper: wrap });
    act(() => result.current.startTour('rules'));
    act(() => result.current.startTour('budgets'));
    expect(result.current.activePageId).toBe('budgets');
    expect(result.current.stepIdx).toBe(0);
    expect(fetchSpy.mock.calls.some(([u]) => String(u).endsWith('/api/tips/dismiss'))).toBe(false);
  });

  it('registerAnchor / getAnchor round-trips a DOM node and bumps anchorVersion', () => {
    const { result } = renderHook(() => useTour(), { wrapper: wrap });
    const el = document.createElement('div');
    const v0 = result.current.anchorVersion;
    act(() => result.current.registerAnchor('dashboard:balance', el));
    expect(result.current.getAnchor('dashboard:balance')).toBe(el);
    expect(result.current.anchorVersion).toBeGreaterThan(v0);
    const v1 = result.current.anchorVersion;
    act(() => result.current.registerAnchor('dashboard:balance', null));
    expect(result.current.getAnchor('dashboard:balance')).toBeNull();
    expect(result.current.anchorVersion).toBeGreaterThan(v1);
  });

  it('last-register-wins when two mounts register the same anchor', () => {
    const { result } = renderHook(() => useTour(), { wrapper: wrap });
    const a = document.createElement('div');
    const b = document.createElement('div');
    act(() => result.current.registerAnchor('accounts:add-button', a));
    act(() => result.current.registerAnchor('accounts:add-button', b));
    expect(result.current.getAnchor('accounts:add-button')).toBe(b);
  });

  it('route change while a tour runs calls abort (no persistence)', async () => {
    const fetchSpy = vi.mocked(globalThis.fetch);
    fetchSpy.mockClear();
    function Harness({ onReady }: { onReady: (nav: (to: string) => void) => void }) {
      const nav = useNavigate();
      onReady(nav);
      return null;
    }
    let navigate: ((to: string) => void) | null = null;
    const { result } = renderHook(() => useTour(), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/']}>
          <TipsProvider>
            <TourProvider>
              <Harness onReady={(n) => { navigate = n; }} />
              {children}
            </TourProvider>
          </TipsProvider>
        </MemoryRouter>
      ),
    });
    act(() => result.current.startTour('dashboard'));
    expect(result.current.activePageId).toBe('dashboard');
    act(() => { navigate!('/transactions'); });
    expect(result.current.activePageId).toBeNull();
    expect(fetchSpy.mock.calls.some(([u]) => String(u).endsWith('/api/tips/dismiss'))).toBe(false);
  });

  it('after 2s with no anchor for the current step, auto-skips forward', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useTour(), { wrapper: wrap });
      act(() => result.current.startTour('dashboard'));
      // No anchor ever registered for 'dashboard:balance'.
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(result.current.stepIdx).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
