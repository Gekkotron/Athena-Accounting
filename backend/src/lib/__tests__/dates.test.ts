import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { todayLocalIso, toLocalIso } from '../dates.js';

describe('todayLocalIso', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('matches the host-local calendar day, not the UTC day', () => {
    // Pin an instant that straddles UTC midnight when read from a
    // negative-offset TZ but stays on the previous day locally. Regardless
    // of the CI runner's TZ, todayLocalIso() must return whatever
    // toLocalIso(new Date()) reports — never UTC directly.
    vi.setSystemTime(new Date('2026-06-15T22:30:00Z'));
    expect(todayLocalIso()).toBe(toLocalIso(new Date()));
    expect(todayLocalIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('formats a Date as YYYY-MM-DD in local components (not toISOString)', () => {
    // 23:30 in a UTC+2 TZ is still day 15 locally; UTC would flip to day 15
    // → 15/UTC vs 15/local is a poor discriminator, so pin a moment where
    // UTC and local COULD diverge and assert the helper uses local getters.
    const d = new Date('2026-01-15T23:30:00Z');
    const iso = toLocalIso(d);
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(iso).toBe(expected);
  });
});
