import { describe, it, expect } from 'vitest';
import { endOfDayRowIds, hasCompleteDays } from '../endOfDay';

describe('endOfDayRowIds', () => {
  it('picks the max-id row per date', () => {
    const rows = [
      { id: 5, date: '2026-01-02' },
      { id: 9, date: '2026-01-02' },
      { id: 7, date: '2026-01-02' },
      { id: 3, date: '2026-01-01' },
    ];
    const s = endOfDayRowIds(rows);
    expect(s.has(9)).toBe(true); // end-of-day for 2026-01-02
    expect(s.has(3)).toBe(true); // sole row for 2026-01-01
    expect(s.has(5)).toBe(false);
    expect(s.has(7)).toBe(false);
    expect(s.size).toBe(2);
  });

  it('treats a single-transaction day as its own end-of-day', () => {
    expect(endOfDayRowIds([{ id: 1, date: '2026-03-03' }])).toEqual(new Set([1]));
  });

  it('returns an empty set for no rows', () => {
    expect(endOfDayRowIds([]).size).toBe(0);
  });
});

describe('hasCompleteDays', () => {
  it('true with no filters, an account filter, or a date range', () => {
    expect(hasCompleteDays({})).toBe(true);
    expect(hasCompleteDays({ search: undefined, amount: undefined })).toBe(true);
  });

  it('false for filters that punch holes inside a day', () => {
    expect(hasCompleteDays({ search: 'carrefour' })).toBe(false);
    expect(hasCompleteDays({ amount: '12,34' })).toBe(false);
    expect(hasCompleteDays({ categoryId: 3 })).toBe(false);
    expect(hasCompleteDays({ sourceFileId: 7 })).toBe(false);
  });
});
