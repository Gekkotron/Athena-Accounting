import { describe, it, expect } from 'vitest';
import { projectBalance } from '../recurring-forecast';
import type { RecurringSeries } from '../../api/types';

function series(
  id: number,
  label: string,
  cadenceDays: number,
  avgAmount: number,
  lastSeenAt: string,
  status: 'detected' | 'confirmed' | 'dismissed' = 'confirmed',
): RecurringSeries {
  return {
    id,
    label,
    cadenceDays,
    avgAmount: (avgAmount < 0 ? '-' : '') + Math.abs(avgAmount).toFixed(2),
    amountStddev: '0.00',
    categoryId: null,
    firstSeenAt: lastSeenAt,
    lastSeenAt,
    nextDueAt: lastSeenAt,
    status,
    essentialness: null,
    createdAt: lastSeenAt + 'T00:00:00.000Z',
    updatedAt: lastSeenAt + 'T00:00:00.000Z',
    memberCount: 3,
  };
}

describe('projectBalance', () => {
  it('returns horizonDays + 1 samples (inclusive of startDate)', () => {
    const out = projectBalance({
      startBalance: 1000,
      series: [],
      horizonDays: 30,
      startDate: '2026-08-01',
    });
    expect(out).toHaveLength(31);
    expect(out[0]!.date).toBe('2026-08-01');
    expect(out[30]!.date).toBe('2026-08-31');
  });

  it('with no series the balance stays flat at startBalance', () => {
    const out = projectBalance({
      startBalance: 1234.56,
      series: [],
      horizonDays: 5,
      startDate: '2026-08-01',
    });
    for (const p of out) expect(p.projectedBalance).toBeCloseTo(1234.56, 2);
  });

  it('applies a monthly series once within the horizon window', () => {
    // Last seen 2026-07-15, cadence 30 → first occurrence in window
    // starting 2026-08-01 is 2026-08-14. That day drops -100.
    const out = projectBalance({
      startBalance: 1000,
      series: [series(1, 'RENT', 30, -100, '2026-07-15')],
      horizonDays: 30,
      startDate: '2026-08-01',
    });
    const dropDay = out.find((p) => p.date === '2026-08-14')!;
    expect(dropDay.projectedBalance).toBeCloseTo(900, 2);
    expect(dropDay.contributions).toEqual([{ seriesId: 1, amount: -100 }]);
    // Balance stays at 900 for the rest of August.
    expect(out.at(-1)!.projectedBalance).toBeCloseTo(900, 2);
  });

  it('mixes cadences (monthly rent, weekly cafe, incoming salary)', () => {
    // Anchor everything to the same startDate so intersections are easy
    // to trace.
    // Cafe: cadence 7, first occurrence 2026-08-02 (7 days after 07-26)
    // Rent: cadence 30, first occurrence 2026-08-14 (30 days after 07-15)
    // Salary: cadence 30, first occurrence 2026-08-01 (30 days after 07-02)
    const cafe = series(2, 'CAFE', 7, -5, '2026-07-26');
    const rent = series(1, 'RENT', 30, -100, '2026-07-15');
    const sal = series(3, 'SAL', 30, 2500, '2026-07-02');
    const out = projectBalance({
      startBalance: 500,
      series: [rent, cafe, sal],
      horizonDays: 30,
      startDate: '2026-08-01',
    });

    // Aug 1: salary lands → 500 + 2500 = 3000.
    expect(out.find((p) => p.date === '2026-08-01')!.projectedBalance).toBeCloseTo(3000, 2);
    // Aug 2: first cafe → 3000 - 5 = 2995.
    expect(out.find((p) => p.date === '2026-08-02')!.projectedBalance).toBeCloseTo(2995, 2);
    // Aug 9: second cafe → 2995 - 5 = 2990.
    expect(out.find((p) => p.date === '2026-08-09')!.projectedBalance).toBeCloseTo(2990, 2);
    // Aug 14: rent → -100 → -100 from the running balance.
    const aug14 = out.find((p) => p.date === '2026-08-14')!;
    // Between 08-02 and 08-14 the cafe fires on 08-02, 08-09; on 08-14
    // itself the cafe fires again (08-02 + 12 not — actually + 7*2 = 08-16).
    // Cafes contributing before or on 08-14: 08-02, 08-09 → 2 × -5 = -10.
    // Balance after Aug 14 = 3000 (salary) - 10 (2 cafes) - 100 (rent) = 2890.
    expect(aug14.projectedBalance).toBeCloseTo(2890, 2);
  });

  it('excludes dismissed series from the projection', () => {
    const rent = series(1, 'RENT', 30, -100, '2026-07-15', 'dismissed');
    const out = projectBalance({
      startBalance: 1000,
      series: [rent],
      horizonDays: 30,
      startDate: '2026-08-01',
    });
    for (const p of out) expect(p.projectedBalance).toBe(1000);
  });

  it('excludes detected series by default (Confirmer is the projection gate)', () => {
    const rent = series(1, 'RENT', 30, -100, '2026-07-15', 'detected');
    const out = projectBalance({
      startBalance: 1000,
      series: [rent],
      horizonDays: 30,
      startDate: '2026-08-01',
    });
    for (const p of out) expect(p.projectedBalance).toBe(1000);
  });

  it('includeDetected=true opts back into detected-and-confirmed', () => {
    const rent = series(1, 'RENT', 30, -100, '2026-07-15', 'detected');
    const out = projectBalance({
      startBalance: 1000,
      series: [rent],
      horizonDays: 30,
      startDate: '2026-08-01',
      includeDetected: true,
    });
    expect(out.find((p) => p.date === '2026-08-14')!.projectedBalance).toBeCloseTo(900, 2);
  });

  it('returns [] when horizonDays is not positive', () => {
    expect(projectBalance({ startBalance: 0, series: [], horizonDays: 0, startDate: '2026-08-01' })).toEqual([]);
    expect(projectBalance({ startBalance: 0, series: [], horizonDays: -1, startDate: '2026-08-01' })).toEqual([]);
  });

  it('handles lastSeen already in the future (skips past occurrences)', () => {
    // lastSeen after startDate should just fire from lastSeen forward.
    const s = series(1, 'FUTURE', 30, -50, '2026-08-10');
    const out = projectBalance({
      startBalance: 0,
      series: [s],
      horizonDays: 30,
      startDate: '2026-08-01',
    });
    // First occurrence is 2026-08-10 (the lastSeen itself, since it's
    // already >= startDate). Next would be 2026-09-09 (outside horizon).
    expect(out.find((p) => p.date === '2026-08-10')!.projectedBalance).toBeCloseTo(-50, 2);
    expect(out.at(-1)!.projectedBalance).toBeCloseTo(-50, 2);
  });
});
