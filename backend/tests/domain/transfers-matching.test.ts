import { describe, it, expect } from 'vitest';
import { addDays, fold, negate } from '../../src/domain/transfers/matching.js';

describe('fold', () => {
  it('lowercases the input', () => {
    expect(fold('VIREMENT')).toBe('virement');
    expect(fold('Virement')).toBe('virement');
  });

  it('strips diacritics (à, é, ç, …)', () => {
    expect(fold('épargne')).toBe('epargne');
    expect(fold('café')).toBe('cafe');
    expect(fold('Française')).toBe('francaise');
    expect(fold('naïve')).toBe('naive');
  });

  it('preserves non-latin characters that carry no combining marks', () => {
    expect(fold('π')).toBe('π');
    expect(fold('日本')).toBe('日本');
  });

  it('is idempotent', () => {
    const s = 'Éléonore';
    expect(fold(fold(s))).toBe(fold(s));
  });
});

describe('addDays', () => {
  it('adds a positive number of days', () => {
    expect(addDays('2026-06-15', 7)).toBe('2026-06-22');
    expect(addDays('2026-06-15', 1)).toBe('2026-06-16');
  });

  it('subtracts when days is negative', () => {
    expect(addDays('2026-06-15', -7)).toBe('2026-06-08');
    expect(addDays('2026-06-15', -1)).toBe('2026-06-14');
  });

  it('crosses month boundaries correctly', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('handles leap years', () => {
    // 2024 is a leap year, 2025 is not
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
  });

  it('crosses year boundaries correctly', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('is stable under DST-transition dates (UTC math)', () => {
    // End-of-March DST switch in France (2026-03-29). UTC arithmetic must
    // not shift the answer to 03-28.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
  });
});

describe('negate', () => {
  it('flips a positive amount to negative', () => {
    expect(negate('12.34')).toBe('-12.34');
    expect(negate('0.00')).toBe('-0.00');
  });

  it('flips a negative amount to positive', () => {
    expect(negate('-12.34')).toBe('12.34');
    expect(negate('-1')).toBe('1');
  });

  it('preserves the string form (no re-formatting)', () => {
    // Keeps the exact digit sequence so drizzle equality checks against a
    // stringly-typed decimal column don't miss due to a "12.3" ≠ "12.30" cast.
    expect(negate('12.3')).toBe('-12.3');
    expect(negate('-100')).toBe('100');
  });

  it('is its own inverse', () => {
    for (const s of ['12.34', '-12.34', '0.01', '-9999.99']) {
      expect(negate(negate(s))).toBe(s);
    }
  });
});
