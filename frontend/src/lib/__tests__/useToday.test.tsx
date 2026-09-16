import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToday } from '../useToday';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-06-15T22:30:00'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useToday', () => {
  it('returns the current local ISO date on mount', () => {
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe('2026-06-15');
  });

  it('updates when the local day rolls over on the next poll tick', () => {
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe('2026-06-15');

    // Cross midnight; the interval fires the next check.
    act(() => {
      vi.setSystemTime(new Date('2026-06-16T00:05:00'));
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current).toBe('2026-06-16');
  });

  it('does not re-render when the day has not changed', () => {
    let renders = 0;
    renderHook(() => {
      renders++;
      return useToday();
    });
    const initial = renders;

    act(() => {
      vi.setSystemTime(new Date('2026-06-15T23:45:00'));
      vi.advanceTimersByTime(60_000);
      vi.advanceTimersByTime(60_000);
    });

    expect(renders).toBe(initial);
  });
});
