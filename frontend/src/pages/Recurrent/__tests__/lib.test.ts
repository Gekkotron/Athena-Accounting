import { describe, it, expect } from 'vitest';
import { cadenceLabel, monthlyEquivalent, monthlyEquivalentTotal } from '../lib';
import type { RecurringSeries } from '../../../api/types';

const series = (over: Partial<RecurringSeries>): RecurringSeries =>
  ({ id: 1, avgAmount: '0', cadenceDays: 30, ...over } as RecurringSeries);

describe('cadenceLabel', () => {
  it('maps the four canonical cadences to French labels', () => {
    expect(cadenceLabel(7)).toBe('Hebdomadaire');
    expect(cadenceLabel(30)).toBe('Mensuel');
    expect(cadenceLabel(90)).toBe('Trimestriel');
    expect(cadenceLabel(365)).toBe('Annuel');
  });

  it('falls back to "N jours" for non-standard cadences', () => {
    expect(cadenceLabel(14)).toBe('14 jours');
    expect(cadenceLabel(1)).toBe('1 jours');
    expect(cadenceLabel(999)).toBe('999 jours');
  });
});

describe('monthlyEquivalent', () => {
  it('scales the avgAmount by 30 / cadenceDays', () => {
    expect(monthlyEquivalent(series({ avgAmount: '10', cadenceDays: 30 }))).toBeCloseTo(10);
    expect(monthlyEquivalent(series({ avgAmount: '10', cadenceDays: 15 }))).toBeCloseTo(20);
    expect(monthlyEquivalent(series({ avgAmount: '90', cadenceDays: 90 }))).toBeCloseTo(30);
  });

  it('preserves the sign so income stays positive and expense stays negative', () => {
    expect(monthlyEquivalent(series({ avgAmount: '-42', cadenceDays: 30 }))).toBeCloseTo(-42);
    expect(monthlyEquivalent(series({ avgAmount: '42', cadenceDays: 30 }))).toBeCloseTo(42);
  });

  it('returns 0 for a non-finite amount', () => {
    expect(monthlyEquivalent(series({ avgAmount: 'NaN', cadenceDays: 30 }))).toBe(0);
    expect(monthlyEquivalent(series({ avgAmount: 'abc', cadenceDays: 30 }))).toBe(0);
  });

  it('returns 0 when cadenceDays is zero or negative (guards against divide-by-zero)', () => {
    expect(monthlyEquivalent(series({ avgAmount: '100', cadenceDays: 0 }))).toBe(0);
    expect(monthlyEquivalent(series({ avgAmount: '100', cadenceDays: -7 }))).toBe(0);
  });
});

describe('monthlyEquivalentTotal', () => {
  it('sums monthlyEquivalent across every row', () => {
    const rows = [
      series({ id: 1, avgAmount: '30', cadenceDays: 30 }),
      series({ id: 2, avgAmount: '-60', cadenceDays: 30 }),
      series({ id: 3, avgAmount: '90', cadenceDays: 90 }),
    ];
    // 30 + (-60) + 30 = 0
    expect(monthlyEquivalentTotal(rows)).toBeCloseTo(0);
  });

  it('returns 0 for an empty list', () => {
    expect(monthlyEquivalentTotal([])).toBe(0);
  });

  it('skips rows with invalid cadences without throwing', () => {
    const rows = [
      series({ id: 1, avgAmount: '100', cadenceDays: 0 }),
      series({ id: 2, avgAmount: '50', cadenceDays: 30 }),
    ];
    expect(monthlyEquivalentTotal(rows)).toBeCloseTo(50);
  });
});
