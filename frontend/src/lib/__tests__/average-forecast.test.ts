import { describe, it, expect } from 'vitest';
import { projectAverageBalance, monthlyFlowAverages } from '../average-forecast';

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

function pt(bucket: string, delta: number): { bucket: string; delta: string } {
  return { bucket, delta: delta.toFixed(2) };
}

describe('monthlyFlowAverages', () => {
  it('returns null for an empty series', () => {
    expect(monthlyFlowAverages([], '2026-07-30')).toBeNull();
  });

  it('returns null when the only month is the opening month', () => {
    expect(monthlyFlowAverages([pt('2026-06-05', 1000)], '2026-07-30')).toBeNull();
  });

  it('excludes the opening month and the current month', () => {
    const points = [
      pt('2026-05-10', 5000), // opening balance folded here — must not count
      pt('2026-06-01', 2000),
      pt('2026-06-15', -800),
      pt('2026-07-02', 9999), // current month — must not count
    ];
    const out = monthlyFlowAverages(points, '2026-07-30')!;
    expect(out.monthCount).toBe(1);
    expect(out.avgIncome).toBeCloseTo(2000, 6);
    expect(out.avgSpend).toBeCloseTo(800, 6);
  });

  it('splits inflows and outflows within a month and averages across months', () => {
    const points = [
      pt('2026-03-01', 100), // opening month
      pt('2026-04-01', 2000),
      pt('2026-04-20', -500),
      pt('2026-05-01', 1000),
      pt('2026-05-20', -300),
    ];
    const out = monthlyFlowAverages(points, '2026-07-30')!;
    expect(out.monthCount).toBe(2);
    expect(out.avgIncome).toBeCloseTo(1500, 6); // (2000 + 1000) / 2
    expect(out.avgSpend).toBeCloseTo(400, 6); // (500 + 300) / 2
  });

  it('caps the window at maxMonths (default 12) most recent eligible months', () => {
    const points = [pt('2024-01-05', 100)]; // opening month
    // 2024-02 .. 2026-06 — 29 eligible months, income i+1 € in month index i.
    for (let i = 0; i < 29; i++) {
      const y = 2024 + Math.floor((1 + i) / 12);
      const m = ((1 + i) % 12) + 1;
      points.push(pt(`${y}-${String(m).padStart(2, '0')}-10`, i + 1));
    }
    const out = monthlyFlowAverages(points, '2026-07-30')!;
    expect(out.monthCount).toBe(12);
    // Last 12 incomes are 18..29 → mean 23.5.
    expect(out.avgIncome).toBeCloseTo(23.5, 6);
  });
});
