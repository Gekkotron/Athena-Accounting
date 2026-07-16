import { describe, it, expect } from 'vitest';
import {
  computeCategoryBalances,
  computePool,
  reallocate,
} from '../src/lib/envelope-math.js';

const M = (y: number, m: number) =>
  `${y}-${String(m).padStart(2, '0')}-01`;

describe('computeCategoryBalances — rollover_negative (default)', () => {
  it('folds cumulative assignments minus spend', () => {
    const r = computeCategoryBalances(
      M(2026, 7),
      [
        { categoryId: 1, month: M(2026, 6), amount: '100.00' },
        { categoryId: 1, month: M(2026, 7), amount: '450.00' },
      ],
      [
        { categoryId: 1, month: M(2026, 6), amount: '20.00' },
        { categoryId: 1, month: M(2026, 7), amount: '510.00' },
      ],
      [],
    );
    // Prior balance = 100 - 20 = 80; then + 450 - 510 = 20
    expect(r.get(1)!.balance).toBe('20.00');
    expect(r.get(1)!.absorbedByPool).toBe('0.00');
    expect(r.get(1)!.overspent).toBe(false);
  });

  it('lets balance go negative and carry', () => {
    const r = computeCategoryBalances(
      M(2026, 7),
      [{ categoryId: 1, month: M(2026, 7), amount: '30.00' }],
      [{ categoryId: 1, month: M(2026, 7), amount: '95.00' }],
      [],
    );
    expect(r.get(1)!.balance).toBe('-65.00');
    expect(r.get(1)!.overspent).toBe(true);
    expect(r.get(1)!.absorbedByPool).toBe('0.00');
  });
});

describe('computeCategoryBalances — reallocate_manual', () => {
  it('resets to 0 next month and reports absorbed amount', () => {
    const r = computeCategoryBalances(
      M(2026, 7),
      [
        { categoryId: 1, month: M(2026, 6), amount: '30.00' },
        { categoryId: 1, month: M(2026, 7), amount: '0.00' },
      ],
      [
        { categoryId: 1, month: M(2026, 6), amount: '95.00' }, // overspend 65
        { categoryId: 1, month: M(2026, 7), amount: '10.00' },
      ],
      [{ categoryId: 1, overspendPolicy: 'reallocate_manual' }],
    );
    // June carry = 0 (absorbed 65). July raw = 0 + 0 - 10 = -10.
    expect(r.get(1)!.balance).toBe('-10.00');
    expect(r.get(1)!.absorbedByPool).toBe('10.00'); // this month's own absorb
    expect(r.get(1)!.overspent).toBe(true);
  });

  it('never shows negative carry across months', () => {
    const r = computeCategoryBalances(
      M(2026, 8),
      [
        { categoryId: 1, month: M(2026, 6), amount: '30.00' },
        { categoryId: 1, month: M(2026, 7), amount: '0.00' },
        { categoryId: 1, month: M(2026, 8), amount: '50.00' },
      ],
      [
        { categoryId: 1, month: M(2026, 6), amount: '95.00' }, // absorb 65
        { categoryId: 1, month: M(2026, 7), amount: '0.00' },
        { categoryId: 1, month: M(2026, 8), amount: '10.00' },
      ],
      [{ categoryId: 1, overspendPolicy: 'reallocate_manual' }],
    );
    // July carry = 0, August raw = 0 + 50 - 10 = 40
    expect(r.get(1)!.balance).toBe('40.00');
    expect(r.get(1)!.absorbedByPool).toBe('0.00');
  });
});

describe('computePool', () => {
  it('applies hold(M-1) release, hold(M) subtract, and prior absorb', () => {
    const p = computePool({
      upToMonth: M(2026, 7),
      incomeCumulative: '18400.00',
      assignmentCumulative: '16900.00',
      holdThisMonth: '0.00',
      holdPriorMonth: '500.00',
      totalAbsorbedPriorMonth: '260.00',
    });
    // 18400 - 16900 - 0 + 500 - 260 = 1740
    expect(p.available).toBe('1740.00');
    expect(p.heldFromPriorMonths).toBe('500.00');
    expect(p.heldForNextMonth).toBe('0.00');
  });

  it('goes negative when over-assigned', () => {
    const p = computePool({
      upToMonth: M(2026, 7),
      incomeCumulative: '1000.00',
      assignmentCumulative: '1500.00',
      holdThisMonth: '0.00',
      holdPriorMonth: '0.00',
      totalAbsorbedPriorMonth: '0.00',
    });
    expect(p.available).toBe('-500.00');
  });
});

describe('reallocate', () => {
  it('subtracts from source, adds to dest, atomic in memory', () => {
    const { from, to } = reallocate(
      { categoryId: 1, month: M(2026, 7), amount: '100.00' },
      { categoryId: 2, month: M(2026, 7), amount: '50.00' },
      '30.00',
    );
    expect(from.amount).toBe('70.00');
    expect(to.amount).toBe('80.00');
  });

  it('treats a null side as an implicit 0 starting row', () => {
    const { from, to } = reallocate(
      null,
      { categoryId: 2, month: M(2026, 7), amount: '0.00' },
      '25.00',
    );
    expect(from.amount).toBe('-25.00');
    expect(to.amount).toBe('25.00');
  });
});
