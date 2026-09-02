import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fromDateFor, toDateFor } from '../RangePicker';

// Month-labeled ranges must cover the last N COMPLETE calendar months —
// [1st of the month N months back, last day of the previous month] — the
// same convention as the Moyennes mensuelles tiles, so "donut total over
// 6 mois" always equals 6 × the displayed monthly average. Fixed day
// counts (180d) chopped the oldest month's salary; including the
// in-progress month made the total undershoot N × average.
describe('fromDateFor / toDateFor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('6m spans the 6 complete months before the current one', () => {
    vi.setSystemTime(new Date(2026, 7, 3)); // 2026-08-03 local
    expect(fromDateFor('6m')).toBe('2026-02-01');
    expect(toDateFor('6m')).toBe('2026-07-31');
  });

  it('3m spans the 3 complete months before the current one', () => {
    vi.setSystemTime(new Date(2026, 7, 3));
    expect(fromDateFor('3m')).toBe('2026-05-01');
    expect(toDateFor('3m')).toBe('2026-07-31');
  });

  it('12m spans the 12 complete months before the current one', () => {
    vi.setSystemTime(new Date(2026, 7, 3));
    expect(fromDateFor('12m')).toBe('2025-08-01');
    expect(toDateFor('12m')).toBe('2026-07-31');
  });

  it('month ranges wrap across year boundaries', () => {
    vi.setSystemTime(new Date(2026, 0, 15)); // 2026-01-15
    expect(fromDateFor('6m')).toBe('2025-07-01');
    expect(fromDateFor('12m')).toBe('2025-01-01');
    expect(toDateFor('6m')).toBe('2025-12-31');
  });

  it('toDate lands on short months correctly', () => {
    vi.setSystemTime(new Date(2026, 2, 31)); // 2026-03-31
    expect(toDateFor('6m')).toBe('2026-02-28');
  });

  it('1m spans the single complete month before the current one', () => {
    vi.setSystemTime(new Date(2026, 8, 2)); // 2026-09-02 local — the case
    // that motivated replacing the old rolling 30-day window with a
    // "previous complete month" range so donut/Sankey no longer mix
    // in half of September.
    expect(fromDateFor('1m')).toBe('2026-08-01');
    expect(toDateFor('1m')).toBe('2026-08-31');
  });

  it('all has no bounds', () => {
    expect(fromDateFor('all')).toBeUndefined();
    expect(toDateFor('all')).toBeUndefined();
  });
});
