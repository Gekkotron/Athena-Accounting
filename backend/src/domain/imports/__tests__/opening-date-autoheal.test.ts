import { describe, it, expect } from 'vitest';
import { shouldShiftOpeningDate } from '../opening-date-autoheal.js';

// The guard only shifts an account's opening_date when TWO conditions
// hold: (a) the current opening_date is today-or-future — i.e. the
// account hasn't "happened" yet, so shifting it doesn't retract a
// factual claim; (b) the earliest imported transaction predates the
// current opening_date, so leaving it in place would silently drop the
// import out of the balance rollup.
describe('shouldShiftOpeningDate', () => {
  const openingIn2100 = { openingDate: '2100-01-01' };
  const openingLastYear = { openingDate: '2025-01-01' };

  it('shifts when opening_date is future AND earliest import predates it', () => {
    expect(shouldShiftOpeningDate(openingIn2100, '2026-06-10', '2026-06-15')).toBe(true);
  });

  it('shifts when opening_date is today AND earliest import predates it', () => {
    expect(shouldShiftOpeningDate({ openingDate: '2026-06-15' }, '2026-06-10', '2026-06-15')).toBe(true);
  });

  it('does not shift when opening_date is already in the past', () => {
    expect(shouldShiftOpeningDate(openingLastYear, '2020-01-01', '2026-06-15')).toBe(false);
  });

  it('does not shift when the earliest import is after opening_date', () => {
    expect(shouldShiftOpeningDate(openingIn2100, '2100-06-01', '2026-06-15')).toBe(false);
  });

  it('does not shift when the earliest import equals opening_date', () => {
    expect(shouldShiftOpeningDate(openingIn2100, '2100-01-01', '2026-06-15')).toBe(false);
  });
});
