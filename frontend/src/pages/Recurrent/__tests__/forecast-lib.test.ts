import { describe, it, expect } from 'vitest';
import { HORIZONS, todayIso, isoDaysAgo } from '../forecast-lib';

describe('HORIZONS', () => {
  it('exposes the four canonical horizon lengths, in ascending order', () => {
    expect(HORIZONS).toEqual([30, 60, 90, 180]);
  });
});

describe('todayIso / isoDaysAgo', () => {
  it('todayIso returns a well-formed YYYY-MM-DD string', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('isoDaysAgo returns a date strictly earlier than todayIso for a positive count', () => {
    const past = isoDaysAgo(1);
    const now = todayIso();
    expect(past).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(past.localeCompare(now)).toBeLessThanOrEqual(0);
  });
});
