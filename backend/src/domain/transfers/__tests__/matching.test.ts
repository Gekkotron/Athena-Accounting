import { describe, it, expect } from 'vitest';
import { addDays, fold, negate } from '../matching.js';

describe('fold', () => {
  it('lowercases and strips French accents', () => {
    expect(fold('Épargne Crédit Été')).toBe('epargne credit ete');
    expect(fold('VIREMENT')).toBe('virement');
    expect(fold('çà et là')).toBe('ca et la');
  });
  it('handles empty strings', () => {
    expect(fold('')).toBe('');
  });
  it('makes accented and unaccented spellings comparable', () => {
    expect(fold('Livret Épargne')).toBe(fold('livret epargne'));
  });
});

describe('addDays', () => {
  it('adds and subtracts days within a month', () => {
    expect(addDays('2026-03-10', 3)).toBe('2026-03-13');
    expect(addDays('2026-03-10', -3)).toBe('2026-03-07');
    expect(addDays('2026-03-10', 0)).toBe('2026-03-10');
  });
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
  it('respects leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
  it('is stable across DST switch dates', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
  });
});

describe('negate', () => {
  it('flips the sign of decimal strings', () => {
    expect(negate('-12.34')).toBe('12.34');
    expect(negate('12.34')).toBe('-12.34');
  });
  it('is its own inverse', () => {
    expect(negate(negate('250.00'))).toBe('250.00');
  });
  it('keeps the string form with trailing zeros', () => {
    expect(negate('-100.00')).toBe('100.00');
  });
});
