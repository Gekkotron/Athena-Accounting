import { describe, expect, it } from 'vitest';
import {
  annotateBudgetRow,
  computeProjected,
  elapsedIn,
  mean,
  median,
  priorPeriodKeys,
  stdev,
} from '../src/http/routes/reports/period-math.js';

const UTC = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe('elapsedIn', () => {
  it('strictly-past period clamps to the whole window', () => {
    const start = UTC(2026, 1, 1);
    const end = UTC(2026, 2, 1);
    const now = UTC(2026, 5, 15);
    expect(elapsedIn(start, end, now)).toBe(31);
  });

  it('strictly-future period returns 0', () => {
    const start = UTC(2027, 1, 1);
    const end = UTC(2027, 2, 1);
    const now = UTC(2026, 5, 15);
    expect(elapsedIn(start, end, now)).toBe(0);
  });

  it('current period, day 1 = 1', () => {
    const start = UTC(2026, 7, 1);
    const end = UTC(2026, 8, 1);
    const now = UTC(2026, 7, 1);
    expect(elapsedIn(start, end, now)).toBe(1);
  });

  it('current period, mid month counts inclusive of today', () => {
    const start = UTC(2026, 7, 1);
    const end = UTC(2026, 8, 1);
    const now = UTC(2026, 7, 10);
    expect(elapsedIn(start, end, now)).toBe(10);
  });

  it('boundary: today == endExclusive → whole window (past)', () => {
    const start = UTC(2026, 7, 1);
    const end = UTC(2026, 8, 1);
    expect(elapsedIn(start, end, end)).toBe(31);
  });
});

describe('computeProjected', () => {
  const start = UTC(2026, 7, 1);
  const end = UTC(2026, 8, 1);

  it('past period locks to spent', () => {
    const now = UTC(2026, 9, 1);
    expect(computeProjected(500, 31, 31, end, now)).toBe('500.00');
  });

  it('elapsedDays < 3 returns null', () => {
    const now = UTC(2026, 7, 2);
    expect(computeProjected(50, 2, 31, end, now)).toBeNull();
  });

  it('linear extrapolation across the window', () => {
    const now = UTC(2026, 7, 10);
    // spent 100 in 10 days, window 31 days → 310.00
    expect(computeProjected(100, 10, 31, end, now)).toBe('310.00');
  });
});

describe('priorPeriodKeys', () => {
  it('monthly returns 6 prior YYYY-MM keys, oldest first, no Jan-wrap bug', () => {
    // currentStart Feb 2026 → prior 6 months Aug 2025 … Jan 2026
    const keys = priorPeriodKeys('monthly', UTC(2026, 2, 1));
    expect(keys).toEqual(['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01']);
  });

  it('yearly returns 6 prior YYYY keys, oldest first', () => {
    const keys = priorPeriodKeys('yearly', UTC(2026, 1, 1));
    expect(keys).toEqual(['2020', '2021', '2022', '2023', '2024', '2025']);
  });
});

describe('mean / median / stdev', () => {
  it('mean of empty returns 0', () => {
    expect(mean([])).toBe(0);
  });

  it('mean of single element', () => {
    expect(mean([5])).toBe(5);
  });

  it('mean averages', () => {
    expect(mean([2, 4, 6])).toBeCloseTo(4);
  });

  it('median: empty → 0', () => {
    expect(median([])).toBe(0);
  });

  it('median: odd length picks middle', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('median: even length averages two middles', () => {
    expect(median([1, 2, 3, 4])).toBeCloseTo(2.5);
  });

  it('stdev of <2 elements returns 0', () => {
    expect(stdev([])).toBe(0);
    expect(stdev([7])).toBe(0);
  });

  it('stdev of all-equal is 0', () => {
    expect(stdev([5, 5, 5, 5])).toBe(0);
  });

  it('stdev of a known set', () => {
    // population stdev of [2,4,4,4,5,5,7,9] = 2
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2);
  });
});

describe('annotateBudgetRow', () => {
  const now = UTC(2026, 7, 10);
  const periodEndExclusive = UTC(2026, 8, 1);

  it('all-zero history → history=null, anomaly=false, suggestedLimit=null', () => {
    const out = annotateBudgetRow({
      spent: 40, limit: 100, elapsedDays: 10, windowDays: 31,
      periodEndExclusive, now, historyValuesNum: [0, 0, 0, 0, 0, 0],
    });
    expect(out.history).toBeNull();
    expect(out.anomaly).toBe(false);
    expect(out.suggestedLimit).toBeNull();
    expect(out.projected).toBe('124.00');
  });

  it('qualifying history (≥2 non-zero) exposes history block', () => {
    const out = annotateBudgetRow({
      spent: 40, limit: 100, elapsedDays: 10, windowDays: 31,
      periodEndExclusive, now, historyValuesNum: [30, 40, 0, 0, 0, 0],
    });
    expect(out.history).not.toBeNull();
    expect(out.history!.values).toHaveLength(6);
  });

  it('anomaly requires ≥3 non-zero AND |spent-mean| > stdev', () => {
    // history [30,40,50,0,0,0]: nonZero=3, mean=20, stdev>0, spent 200 is anomalous
    const out = annotateBudgetRow({
      spent: 200, limit: 100, elapsedDays: 10, windowDays: 31,
      periodEndExclusive, now, historyValuesNum: [30, 40, 50, 0, 0, 0],
    });
    expect(out.anomaly).toBe(true);
  });

  it('suggestedLimit fires when overCount ≥ 3 and rounds up ~10%', () => {
    // history all > 100 → overCount=4, median=110, round(110)*1.1=121
    const out = annotateBudgetRow({
      spent: 90, limit: 100, elapsedDays: 10, windowDays: 31,
      periodEndExclusive, now, historyValuesNum: [110, 110, 110, 110, 0, 0],
    });
    expect(out.suggestedLimit).toBe('121.00');
  });

  it('suggestedLimit stays null when history is too sparse', () => {
    const out = annotateBudgetRow({
      spent: 90, limit: 100, elapsedDays: 10, windowDays: 31,
      periodEndExclusive, now, historyValuesNum: [110, 0, 0, 0, 0, 0],
    });
    expect(out.suggestedLimit).toBeNull();
  });

  it('suggestedLimit is null when the rounded proposal equals the current limit', () => {
    // history [5,5,17,49,49,50] sorted; median = (17+49)/2 = 33
    // round(33)*1.1 = 36.3 → round = 36 = limit. overCount=3 (49,49,50)
    // would otherwise trigger the suggestion.
    const out = annotateBudgetRow({
      spent: 20, limit: 36, elapsedDays: 10, windowDays: 31,
      periodEndExclusive, now, historyValuesNum: [5, 5, 17, 49, 49, 50],
    });
    expect(out.suggestedLimit).toBeNull();
  });
});
