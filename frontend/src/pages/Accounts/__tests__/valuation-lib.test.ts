import { describe, it, expect } from 'vitest';
import { formatGainPct, gainToneClass, isValuationStale, numberLocale, signedAmount } from '../valuation-lib';

describe('isValuationStale', () => {
  it('is false for null and for dates within 30 days', () => {
    expect(isValuationStale(null, '2026-07-18')).toBe(false);
    expect(isValuationStale('2026-06-18', '2026-07-18')).toBe(false); // exactly 30 days
  });
  it('is true past 30 days', () => {
    expect(isValuationStale('2026-06-17', '2026-07-18')).toBe(true);
  });
});

describe('formatGainPct', () => {
  it('scales the ratio and signs it', () => {
    expect(formatGainPct(0.0523, 'en-US')).toBe('+5.23 %');
    expect(formatGainPct(-0.1, 'en-US')).toBe('-10.00 %');
    expect(formatGainPct(0, 'en-US')).toBe('0.00 %');
  });
});

describe('signedAmount / gainToneClass / numberLocale', () => {
  const fmt = (v: string | number) => `${v}€`;
  it('prefixes + on positives only', () => {
    expect(signedAmount('12.5', fmt)).toBe('+12.5€');
    expect(signedAmount('-3', fmt)).toBe('-3€');
  });
  it('picks green, red or neutral tone', () => {
    expect(gainToneClass('5')).toContain('sage');
    expect(gainToneClass('-5')).toContain('clay');
    expect(gainToneClass('0.00')).toContain('ink');
    expect(gainToneClass(null)).toContain('ink');
  });
  it('maps UI language to number locale', () => {
    expect(numberLocale('en')).toBe('en-US');
    expect(numberLocale('fr')).toBe('fr-FR');
  });
});
