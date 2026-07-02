import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePersistedState } from '../persisted-state';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('usePersistedState', () => {
  it('returns the initial value when no persisted entry exists', () => {
    const { result } = renderHook(() => usePersistedState('k1', 'default'));
    expect(result.current[0]).toBe('default');
  });

  it('reads a previously persisted value on mount', () => {
    localStorage.setItem('k2', JSON.stringify(42));
    const { result } = renderHook(() => usePersistedState<number>('k2', 0));
    expect(result.current[0]).toBe(42);
  });

  it('writes to localStorage on state change', () => {
    const { result } = renderHook(() => usePersistedState<'all' | number>('k3', 'all'));
    act(() => { result.current[1](7); });
    expect(JSON.parse(localStorage.getItem('k3') as string)).toBe(7);
    act(() => { result.current[1]('all'); });
    expect(JSON.parse(localStorage.getItem('k3') as string)).toBe('all');
  });

  it('accepts a factory initial value', () => {
    const factory = vi.fn(() => 'computed');
    const { result } = renderHook(() => usePersistedState('k4', factory));
    expect(result.current[0]).toBe('computed');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('falls back to initial when the stored JSON is corrupt', () => {
    localStorage.setItem('k5', '{not valid json');
    const { result } = renderHook(() => usePersistedState('k5', 'fallback'));
    expect(result.current[0]).toBe('fallback');
  });

  it('does not throw when localStorage.setItem raises (quota exceeded)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { result } = renderHook(() => usePersistedState('k6', 'x'));
    expect(() => act(() => { result.current[1]('y'); })).not.toThrow();
    expect(result.current[0]).toBe('y');
    spy.mockRestore();
  });
});
