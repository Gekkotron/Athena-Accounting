import { describe, it, expect } from 'vitest';
import { resolveRate } from '../resolve-rate.js';
import type { FxRate } from '../types.js';

const R = (fromCcy: string, toCcy: string, effectiveFrom: string, rate: string): FxRate =>
  ({ fromCcy, toCcy, effectiveFrom, rate });

describe('resolveRate', () => {
  it('returns 1 when from === to', () => {
    expect(resolveRate([], 'EUR', 'EUR', '2026-01-01')).toBe(1);
  });

  it('finds an exact-date rate', () => {
    const rates = [R('USD', 'EUR', '2026-01-01', '0.9')];
    expect(resolveRate(rates, 'USD', 'EUR', '2026-01-01')).toBe(0.9);
  });

  it('finds the most recent rate on or before the target date', () => {
    const rates = [
      R('USD', 'EUR', '2026-01-01', '0.9'),
      R('USD', 'EUR', '2026-06-01', '0.85'),
    ];
    expect(resolveRate(rates, 'USD', 'EUR', '2026-03-15')).toBe(0.9);
    expect(resolveRate(rates, 'USD', 'EUR', '2026-07-01')).toBe(0.85);
  });

  it('returns null when no rate exists for the pair', () => {
    expect(resolveRate([], 'USD', 'EUR', '2026-01-01')).toBeNull();
  });

  it('returns null when all effective dates are after the target', () => {
    const rates = [R('USD', 'EUR', '2026-06-01', '0.85')];
    expect(resolveRate(rates, 'USD', 'EUR', '2026-01-01')).toBeNull();
  });

  it('does not derive the reverse pair from a stored (from,to) row', () => {
    const rates = [R('USD', 'EUR', '2026-01-01', '0.9')];
    expect(resolveRate(rates, 'EUR', 'USD', '2026-01-01')).toBeNull();
  });
});
