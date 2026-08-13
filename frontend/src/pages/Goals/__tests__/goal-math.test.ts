import { describe, it, expect } from 'vitest';
import { colorBand, computeProjection, sortBySoonest } from '../goal-math';
import type { SavingsGoal } from '../../../api/types';

describe('colorBand', () => {
  it('is green below 80 %', () => {
    expect(colorBand(0)).toBe('green');
    expect(colorBand(50)).toBe('green');
    expect(colorBand(79.9)).toBe('green');
  });
  it('is amber in [80, 100)', () => {
    expect(colorBand(80)).toBe('amber');
    expect(colorBand(99)).toBe('amber');
  });
  it('is red at 100 % and above (overshoots read red)', () => {
    expect(colorBand(100)).toBe('red');
    expect(colorBand(150)).toBe('red');
  });
});

describe('computeProjection', () => {
  it('rawPct and progressPct diverge on overshoot', () => {
    const r = computeProjection({ target: 100, saved: 150, targetDate: null, todayIso: '2026-06-15' });
    expect(r.rawPct).toBe(150);
    expect(r.progressPct).toBe(100);
    expect(r.perMonthNeeded).toBeNull();
    expect(r.overdueDays).toBeNull();
  });

  it('sets overdueDays when past deadline and under target', () => {
    const r = computeProjection({
      target: 1000, saved: 200,
      targetDate: '2026-06-01', todayIso: '2026-06-11',
    });
    expect(r.perMonthNeeded).toBeNull();
    expect(r.overdueDays).toBe(10);
  });

  it('past deadline but reached: neither perMonthNeeded nor overdueDays', () => {
    const r = computeProjection({
      target: 1000, saved: 1500,
      targetDate: '2026-06-01', todayIso: '2026-06-11',
    });
    expect(r.perMonthNeeded).toBeNull();
    expect(r.overdueDays).toBeNull();
  });

  it('future deadline: perMonthNeeded is roughly (target-saved)/months', () => {
    // ~365 days out at (1000-100)/12 ≈ 75 €/mo
    const r = computeProjection({
      target: 1000, saved: 100,
      targetDate: '2027-06-15', todayIso: '2026-06-15',
    });
    expect(r.overdueDays).toBeNull();
    const perMonth = Number(r.perMonthNeeded);
    expect(perMonth).toBeGreaterThan(70);
    expect(perMonth).toBeLessThan(80);
  });

  it('hides both projection lines when targetDate is null', () => {
    const r = computeProjection({ target: 500, saved: 100, targetDate: null, todayIso: '2026-06-15' });
    expect(r.perMonthNeeded).toBeNull();
    expect(r.overdueDays).toBeNull();
  });

  it('already reached on a future deadline: perMonthNeeded is 0', () => {
    const r = computeProjection({
      target: 500, saved: 600,
      targetDate: '2027-06-15', todayIso: '2026-06-15',
    });
    expect(r.perMonthNeeded).toBe('0.00');
  });
});

describe('sortBySoonest', () => {
  function mk(id: number, targetDate: string | null, rawPct: number): SavingsGoal {
    return {
      id, accountId: 1, name: `g${id}`,
      targetAmount: '1000.00', targetDate,
      color: null, closedAt: null, currency: 'EUR',
      savedAmount: '0.00', eventCount: 0,
      rawPct, progressPct: Math.min(100, rawPct),
      perMonthNeeded: null, overdueDays: null,
    };
  }
  it('sorts by soonest deadline; null last; tie-break on lowest rawPct', () => {
    const rows = [
      mk(1, null, 90),
      mk(2, '2026-12-01', 30),
      mk(3, '2026-06-01', 80),
      mk(4, '2026-06-01', 20),
    ];
    const sorted = rows.slice().sort(sortBySoonest);
    expect(sorted.map((g) => g.id)).toEqual([4, 3, 2, 1]);
  });
});
