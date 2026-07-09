import { describe, it, expect } from 'vitest';
import { computeRunningBalances } from '../src/http/routes/transactions/running-balance.js';

describe('computeRunningBalances', () => {
  it('accumulates from the opening balance in chronological order', () => {
    const rows = [
      { id: 1, amount: '100.00' },
      { id: 2, amount: '-30.00' },
      { id: 3, amount: '-4.50' },
    ];
    const m = computeRunningBalances(rows, '50.00');
    expect(m.get(1)).toBe('150.00');
    expect(m.get(2)).toBe('120.00');
    expect(m.get(3)).toBe('115.50');
  });

  it('last row equals opening + sum of all amounts (== currentBalance)', () => {
    const rows = [
      { id: 1, amount: '1000.00' },
      { id: 2, amount: '-333.33' },
      { id: 3, amount: '-666.67' },
    ];
    const m = computeRunningBalances(rows, '0.00');
    expect(m.get(3)).toBe('0.00');
  });

  it('sums in cents to avoid float drift (0.10 + 0.20 === 0.30)', () => {
    const rows = [
      { id: 1, amount: '0.10' },
      { id: 2, amount: '0.20' },
    ];
    const m = computeRunningBalances(rows, '0.00');
    expect(m.get(2)).toBe('0.30');
  });

  it('handles negative balances and a zero opening', () => {
    const rows = [{ id: 7, amount: '-0.05' }];
    const m = computeRunningBalances(rows, '0.00');
    expect(m.get(7)).toBe('-0.05');
  });

  it('returns an empty map for no rows', () => {
    expect(computeRunningBalances([], '10.00').size).toBe(0);
  });
});
