import { describe, it, expect } from 'vitest';
import { normalizeSparkline, summarizePace } from '../budget-math';

describe('normalizeSparkline', () => {
  it('scales values relative to their max and flags the last bar as current', () => {
    const bars = normalizeSparkline(['10.00', '20.00', '40.00', '30.00']);
    expect(bars).toHaveLength(4);
    expect(bars[0]!.height).toBeCloseTo(0.25, 3);
    expect(bars[2]!.height).toBeCloseTo(1, 3);
    expect(bars[3]!.isCurrent).toBe(true);
    expect(bars[2]!.isCurrent).toBe(false);
  });

  it('gives zero-only inputs a flat 0-height sparkline', () => {
    const bars = normalizeSparkline(['0.00', '0.00', '0.00']);
    expect(bars.every((b) => b.height === 0)).toBe(true);
  });

  it('handles an empty input', () => {
    expect(normalizeSparkline([])).toEqual([]);
  });
});

describe('summarizePace', () => {
  it('returns "unknown" when projected is null', () => {
    expect(summarizePace({ limit: '100.00', spent: '20.00', remaining: '80.00', projected: null }))
      .toBe('unknown');
  });
  it('returns "over" when projected > limit', () => {
    expect(summarizePace({ limit: '100.00', spent: '80.00', remaining: '20.00', projected: '150.00' }))
      .toBe('over');
  });
  it('returns "onTrack" when projected <= limit', () => {
    expect(summarizePace({ limit: '100.00', spent: '40.00', remaining: '60.00', projected: '90.00' }))
      .toBe('onTrack');
  });
});
