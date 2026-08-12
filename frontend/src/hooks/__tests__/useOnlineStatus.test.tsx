import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useOnlineStatus } from '../useOnlineStatus';

// jsdom exposes navigator.onLine as a plain property (initial value: true).
// The hook then flips on the window `online`/`offline` events. We keep the
// suite in "originally online" state and toggle by dispatching those events.
function setNavigatorOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

describe('useOnlineStatus', () => {
  afterEach(() => {
    setNavigatorOnline(true);
  });

  it('returns true when navigator reports online', () => {
    setNavigatorOnline(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
  });

  it('returns false initially when navigator reports offline', () => {
    setNavigatorOnline(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);
  });

  it('flips to false on the window offline event and back to true on online', () => {
    setNavigatorOnline(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe(true);
  });

  it('unsubscribes on unmount so late events do not touch stale state', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useOnlineStatus());
    const addedOffline = addSpy.mock.calls.some(([evt]) => evt === 'offline');
    const addedOnline = addSpy.mock.calls.some(([evt]) => evt === 'online');
    expect(addedOffline && addedOnline).toBe(true);
    unmount();
    const removedOffline = removeSpy.mock.calls.some(([evt]) => evt === 'offline');
    const removedOnline = removeSpy.mock.calls.some(([evt]) => evt === 'online');
    expect(removedOffline && removedOnline).toBe(true);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
