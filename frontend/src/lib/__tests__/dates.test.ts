import { describe, expect, it } from 'vitest';
import { toLocalIso, todayLocalIso } from '../dates';

describe('toLocalIso', () => {
  it('pads single-digit month and day', () => {
    expect(toLocalIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('returns the LOCAL calendar day at the end-of-day boundary', () => {
    // Local 23:59 on Dec 31. A UTC-based implementation
    // (toISOString().slice(0, 10)) reports Jan 1 of the next year on any
    // runner west of UTC; the local implementation never flips.
    expect(toLocalIso(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });

  it('returns the LOCAL calendar day just after local midnight', () => {
    // Local 00:30 on Jan 1. A UTC-based implementation reports Dec 31 of
    // the PREVIOUS year on any runner east of UTC (e.g. Europe/Paris);
    // the local implementation never flips.
    expect(toLocalIso(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
  });
});

describe('todayLocalIso', () => {
  it('is the local calendar day of now, in YYYY-MM-DD shape', () => {
    const now = new Date();
    expect(todayLocalIso()).toBe(toLocalIso(now));
    expect(todayLocalIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
