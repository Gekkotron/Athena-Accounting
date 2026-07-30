import { describe, it, expect } from 'vitest';
import { projectAverageBalance } from '../average-forecast';

describe('projectAverageBalance', () => {
  it('returns [] for a non-positive horizon', () => {
    expect(
      projectAverageBalance({ startBalance: 100, avgMonthlyIncome: 0, avgMonthlySpend: 0, horizonDays: 0, startDate: '2026-08-01' }),
    ).toEqual([]);
  });

  it('emits horizonDays + 1 samples, index 0 = startDate at startBalance', () => {
    const out = projectAverageBalance({ startBalance: 1000, avgMonthlyIncome: 0, avgMonthlySpend: 0, horizonDays: 30, startDate: '2026-08-15' });
    expect(out).toHaveLength(31);
    expect(out[0]).toEqual({ date: '2026-08-15', value: 1000 });
    expect(out[30]!.date).toBe('2026-09-14');
  });

  it('steps up by avgMonthlyIncome on the 1st of each month', () => {
    const out = projectAverageBalance({ startBalance: 500, avgMonthlyIncome: 3000, avgMonthlySpend: 0, horizonDays: 20, startDate: '2026-08-25' });
    const aug31 = out.find((p) => p.date === '2026-08-31')!;
    const sep01 = out.find((p) => p.date === '2026-09-01')!;
    expect(aug31.value).toBe(500); // no income before the month boundary
    expect(sep01.value).toBe(3500); // salary lands on the 1st
  });

  it('drifts down by avgMonthlySpend spread over the days of each month', () => {
    // August has 31 days → 310/31 = 10 €/day.
    const out = projectAverageBalance({ startBalance: 1000, avgMonthlyIncome: 0, avgMonthlySpend: 310, horizonDays: 3, startDate: '2026-08-10' });
    expect(out[1]!.value).toBeCloseTo(990, 6);
    expect(out[3]!.value).toBeCloseTo(970, 6);
  });

  it('uses each month own length for the drift (Feb 2027 = 28 days)', () => {
    const out = projectAverageBalance({ startBalance: 0, avgMonthlyIncome: 0, avgMonthlySpend: 280, horizonDays: 2, startDate: '2027-02-10' });
    expect(out[1]!.value).toBeCloseTo(-10, 6);
  });

  it('nets exactly income − spend over one full month', () => {
    // startDate on the last day of July → days 1..31 cover all of August.
    const out = projectAverageBalance({ startBalance: 2000, avgMonthlyIncome: 3000, avgMonthlySpend: 2500, horizonDays: 31, startDate: '2026-07-31' });
    expect(out[31]!.date).toBe('2026-08-31');
    expect(out[31]!.value).toBeCloseTo(2500, 6); // 2000 + 3000 − 2500
  });
});
