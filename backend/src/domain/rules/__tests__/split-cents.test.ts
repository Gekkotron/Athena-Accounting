import { describe, it, expect } from 'vitest';
import { computeSplitCents } from '../split-cents.js';

// The rule engine emits transaction_splits from rule_splits by scaling the
// parent transaction's amount (in cents) against the per-split percent set.
// The transaction_splits deferrable trigger requires the sum of split
// amounts to equal the parent amount exactly — so any rounding drift from
// per-row Math.round has to be absorbed by one row. computeSplitCents pins
// that contract as a pure function so the engine layer stays simple.

describe('computeSplitCents', () => {
  it('splits evenly when percentages divide the amount cleanly', () => {
    // 100.00 € across 2×50% → [50.00, 50.00]
    expect(computeSplitCents(10000, [50, 50])).toEqual([5000, 5000]);
    // 100.00 € across 4×25% → [25.00, 25.00, 25.00, 25.00]
    expect(computeSplitCents(10000, [25, 25, 25, 25])).toEqual([2500, 2500, 2500, 2500]);
  });

  it('the last row absorbs the drift so the sum matches exactly', () => {
    // 10.03 € across 3×33% + 34% — naive rounding gives 331 + 331 + 341 = 1003,
    // but 100/3 percentages force at least one row to absorb the extra cent.
    // Concretely: 33%/33%/34% of 1003c → [331, 331, 341] — last row wins the drift.
    const cents = computeSplitCents(1003, [33, 33, 34]);
    expect(cents.reduce((a, b) => a + b, 0)).toBe(1003);
    expect(cents).toEqual([331, 331, 341]);
  });

  it('handles extreme percent ratios without losing a cent', () => {
    // 99% / 1% of 100.00 € → [99.00, 1.00]
    expect(computeSplitCents(10000, [99, 1])).toEqual([9900, 100]);
    // 1% / 99% of 100.00 € → [1.00, 99.00]
    expect(computeSplitCents(10000, [1, 99])).toEqual([100, 9900]);
  });

  it('handles tiny amounts where naive per-row rounding would drop a cent', () => {
    // 0.10 € (10 cents) across 33/33/34 — 10*0.33=3.3 → naive [3, 3, 3] would
    // sum to 9c, one short. Drift absorption gives [3, 3, 4].
    const cents = computeSplitCents(10, [33, 33, 34]);
    expect(cents.reduce((a, b) => a + b, 0)).toBe(10);
    expect(cents).toEqual([3, 3, 4]);
  });

  it('preserves the sign of negative amounts', () => {
    // -50.00 € across 60% / 40% → [-30.00, -20.00]
    const cents = computeSplitCents(-5000, [60, 40]);
    expect(cents.reduce((a, b) => a + b, 0)).toBe(-5000);
    expect(cents).toEqual([-3000, -2000]);
  });

  it('handles a 20-row split (spec maximum) without drift', () => {
    // 100.00 € across 20×5% → [500 × 20]
    const cents = computeSplitCents(10000, Array(20).fill(5));
    expect(cents.reduce((a, b) => a + b, 0)).toBe(10000);
    expect(cents).toEqual(Array(20).fill(500));
  });

  it('throws when percents do not sum to 100', () => {
    expect(() => computeSplitCents(10000, [50, 40])).toThrow(/sum.*100/i);
    expect(() => computeSplitCents(10000, [50, 60])).toThrow(/sum.*100/i);
  });

  it('throws when the split list is empty', () => {
    expect(() => computeSplitCents(10000, [])).toThrow(/at least/i);
  });
});
