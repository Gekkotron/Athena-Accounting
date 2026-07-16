import { describe, it, expect } from 'vitest';
import { formatSignedMoney, computeTargetProgress } from '../envelope-math';

describe('formatSignedMoney', () => {
  it('formats positive with regular sign', () => {
    expect(formatSignedMoney('12.50')).toBe('12,50 €');
  });
  it('keeps the minus for negatives', () => {
    // U+2212 minus sign, U+00A0 non-breaking space (what Intl.NumberFormat('fr-FR') actually emits).
    expect(formatSignedMoney('-65.00')).toBe('−65,00 €');
  });
});

describe('computeTargetProgress', () => {
  it('returns null when no target', () => {
    expect(computeTargetProgress({ target: null, balance: '10.00', assignment: '0.00' })).toBeNull();
  });
  it('save_by_date uses balance / amount', () => {
    expect(computeTargetProgress({
      target: { amount: '1200.00', date: '2026-12-01', kind: 'save_by_date' },
      balance: '700.00', assignment: '100.00',
    })!.pct).toBeCloseTo(700 / 1200, 3);
  });
  it('monthly_recurring uses assignment / amount', () => {
    expect(computeTargetProgress({
      target: { amount: '500.00', date: null, kind: 'monthly_recurring' },
      balance: '0.00', assignment: '450.00',
    })!.pct).toBeCloseTo(450 / 500, 3);
  });
});
