import { describe, expect, it } from 'vitest';
import {
  parseAmountAuto,
  parseFrenchAmount,
  parseFrenchDate,
  tryParseFrenchAmount,
  tryParseFrenchDate,
} from '../french-numerics.js';

describe('parseFrenchDate', () => {
  it.each([
    ['27/06/2026', '2026-06-27'],
    ['1/2/2026', '2026-02-01'],
    ['01-02-2026', '2026-02-01'],
    ['01.02.2026', '2026-02-01'],
    ['  15/03/2024  ', '2024-03-15'],
    ['05/05/69', '2069-05-05'],
    ['05/05/70', '1970-05-05'],
    ['05/05/99', '1999-05-05'],
  ])('parses %s', (input, expected) => {
    expect(parseFrenchDate(input)).toBe(expected);
  });

  it.each(['', '2026-06-27', '32/01/2026', '00/01/2026', '10/13/2026', '10/00/2026', 'abc', '1/1/202'])(
    'rejects %j',
    (input) => {
      expect(() => parseFrenchDate(input)).toThrow(/invalid French date/);
    },
  );

  it('tryParseFrenchDate returns null on failure', () => {
    expect(tryParseFrenchDate('nope')).toBeNull();
    expect(tryParseFrenchDate('01/02/2026')).toBe('2026-02-01');
  });
});

describe('parseFrenchAmount', () => {
  it.each([
    ['1 234,56', '1234.56'],
    ['1 234,56', '1234.56'],
    ['1 234,56', '1234.56'],
    ['1 234,56', '1234.56'],
    ['-1.234,56', '-1234.56'],
    ['-25,3', '-25.30'],
    ['0', '0.00'],
    ['0,00', '0.00'],
    ['-0,00', '0.00'],
    ['12 €', '12.00'],
    ['$ 5,5', '5.50'],
    ['1.234.567,89', '1234567.89'],
  ])('parses %j', (input, expected) => {
    expect(parseFrenchAmount(input)).toBe(expected);
  });

  it('returns empty string for blank input', () => {
    expect(parseFrenchAmount('')).toBe('');
    expect(parseFrenchAmount('   ')).toBe('');
  });

  it('treats a dot as a thousands separator (French convention)', () => {
    expect(parseFrenchAmount('950.00')).toBe('95000.00');
  });

  it.each(['abc', '1,2,3', '--5', '12,5x'])('rejects %j', (input) => {
    expect(() => parseFrenchAmount(input)).toThrow(/invalid amount/);
  });

  it('tryParseFrenchAmount maps blank and invalid to null', () => {
    expect(tryParseFrenchAmount('')).toBeNull();
    expect(tryParseFrenchAmount('abc')).toBeNull();
    expect(tryParseFrenchAmount('3,5')).toBe('3.50');
  });
});

describe('parseAmountAuto', () => {
  it.each([
    ['-950.00', '-950.00'],
    ['950,00', '950.00'],
    ['1,234.56', '1234.56'],
    ['1.234,56', '1234.56'],
    ['12.345.678', '12345678.00'],
    ['1,234,567', '1234567.00'],
    ['1 234,56 €', '1234.56'],
    ['1 234.5', '1234.50'],
    ['42', '42.00'],
    ['-0.5', '-0.50'],
    ['0', '0.00'],
  ])('parses %j', (input, expected) => {
    expect(parseAmountAuto(input)).toBe(expected);
  });

  it('returns empty string for blank input', () => {
    expect(parseAmountAuto('')).toBe('');
    expect(parseAmountAuto('  ')).toBe('');
  });

  it.each(['1.2345', '1,2345', 'abc', '1.23.4', '1,23,4'])('rejects %j', (input) => {
    expect(() => parseAmountAuto(input)).toThrow(/invalid amount/);
  });
});
