import { describe, it, expect } from 'vitest';
import {
  parseFrenchAmount,
  parseFrenchDate,
  tryParseFrenchAmount,
  tryParseFrenchDate,
} from '../../src/domain/imports/french-numerics.js';

describe('parseFrenchDate', () => {
  it('accepts DD/MM/YYYY, DD-MM-YYYY and DD.MM.YYYY', () => {
    expect(parseFrenchDate('15/06/2026')).toBe('2026-06-15');
    expect(parseFrenchDate('15-06-2026')).toBe('2026-06-15');
    expect(parseFrenchDate('15.06.2026')).toBe('2026-06-15');
  });

  it('zero-pads a single-digit day and month', () => {
    expect(parseFrenchDate('1/2/2026')).toBe('2026-02-01');
    expect(parseFrenchDate('9/3/2024')).toBe('2024-03-09');
  });

  it('expands a 2-digit year: >=70 → 19xx, else 20xx', () => {
    expect(parseFrenchDate('01/01/70')).toBe('1970-01-01');
    expect(parseFrenchDate('01/01/99')).toBe('1999-01-01');
    expect(parseFrenchDate('01/01/00')).toBe('2000-01-01');
    expect(parseFrenchDate('01/01/69')).toBe('2069-01-01');
  });

  it('rejects malformed strings', () => {
    for (const bad of ['', 'nope', '2024-06-15', '32/01/2024', '01/13/2024', '01/00/2024', '00/01/2024']) {
      expect(() => parseFrenchDate(bad)).toThrow(/invalid French date/);
    }
  });

  it('tryParseFrenchDate returns null instead of throwing on invalid input', () => {
    expect(tryParseFrenchDate('nope')).toBeNull();
    expect(tryParseFrenchDate('15/06/2026')).toBe('2026-06-15');
  });
});

describe('parseFrenchAmount', () => {
  it("returns '' for empty / whitespace-only input", () => {
    expect(parseFrenchAmount('')).toBe('');
    expect(parseFrenchAmount('   ')).toBe('');
  });

  it('strips currency symbols and thin/non-breaking spaces', () => {
    expect(parseFrenchAmount('12,34 €')).toBe('12.34');
    expect(parseFrenchAmount('€ 12,34')).toBe('12.34');
    expect(parseFrenchAmount('$12,34')).toBe('12.34');
    expect(parseFrenchAmount('12 345,67')).toBe('12345.67');
  });

  it('treats "." as a thousands separator and "," as the decimal', () => {
    expect(parseFrenchAmount('1.234,56')).toBe('1234.56');
    expect(parseFrenchAmount('12.345.678,90')).toBe('12345678.90');
  });

  it('preserves the sign', () => {
    expect(parseFrenchAmount('-12,34')).toBe('-12.34');
    expect(parseFrenchAmount('12,34')).toBe('12.34');
  });

  it('throws on garbage that no thousands/decimal rule can rescue', () => {
    expect(() => parseFrenchAmount('abc')).toThrow(/invalid amount/);
    expect(() => parseFrenchAmount('12,34,56')).toThrow(/invalid amount/);
  });

  it('tryParseFrenchAmount returns null on invalid + on empty', () => {
    expect(tryParseFrenchAmount('')).toBeNull();
    expect(tryParseFrenchAmount('   ')).toBeNull();
    expect(tryParseFrenchAmount('abc')).toBeNull();
    expect(tryParseFrenchAmount('12,34')).toBe('12.34');
  });
});
