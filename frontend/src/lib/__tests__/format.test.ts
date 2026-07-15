import { describe, it, expect } from 'vitest';
import { parseDecimal } from '../format';

describe('parseDecimal', () => {
  it('accepts the French decimal comma', () => {
    expect(parseDecimal('1,50')).toBe('1.50');
    expect(parseDecimal('-25,30')).toBe('-25.30');
  });

  it('accepts the English decimal period', () => {
    expect(parseDecimal('1.50')).toBe('1.50');
    expect(parseDecimal('-25.30')).toBe('-25.30');
  });

  it('accepts integers', () => {
    expect(parseDecimal('338')).toBe('338');
    expect(parseDecimal('-1')).toBe('-1');
    expect(parseDecimal('0')).toBe('0');
  });

  it('strips euro sign and interior whitespace', () => {
    expect(parseDecimal('338,50 €')).toBe('338.50');
    expect(parseDecimal('1 338,50 €')).toBe('1338.50');
    expect(parseDecimal(' 42 ')).toBe('42');
  });

  it('rejects empty and whitespace-only input', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('   ')).toBeNull();
  });

  it('rejects non-numeric text', () => {
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('1,50 foo')).toBeNull();
  });

  it('rejects malformed decimals', () => {
    expect(parseDecimal('1,')).toBeNull();
    expect(parseDecimal(',5')).toBeNull();
    expect(parseDecimal('1.2.3')).toBeNull();
  });

  it('rejects more than two decimal places', () => {
    expect(parseDecimal('1,555')).toBeNull();
    expect(parseDecimal('1.555')).toBeNull();
  });
});
