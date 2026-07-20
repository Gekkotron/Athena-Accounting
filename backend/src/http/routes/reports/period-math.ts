// Days elapsed inside [start, endExclusive), clamped to the window. Uses UTC
// midnight of `now` so the boundary is consistent with the SQL date filter.
// - Strictly past periods (today's midnight >= endExclusive) clamp to the
//   whole window (elapsedDays === windowDays).
// - Strictly future periods (today's midnight < start) are 0.
// - Otherwise (today falls inside [start, endExclusive)) day 1 of the period
//   counts as elapsedDays = 1, day 2 as 2, etc. (inclusive of today).
export function elapsedIn(start: Date, endExclusive: Date, now: Date): number {
  const todayUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (todayUtcMidnight >= endExclusive) {
    return Math.round((endExclusive.getTime() - start.getTime()) / 86_400_000);
  }
  if (todayUtcMidnight < start) return 0;
  return Math.round((todayUtcMidnight.getTime() - start.getTime()) / 86_400_000) + 1;
}

// projected = null when it's too early in the current period to extrapolate
// (elapsedDays < 3); locked to `spent` for strictly past periods; otherwise a
// linear extrapolation of spend across the whole window.
export function computeProjected(
  spent: number,
  elapsedDays: number,
  windowDays: number,
  endExclusive: Date,
  now: Date,
): string | null {
  if (now >= endExclusive) return spent.toFixed(2);
  if (elapsedDays < 3) return null;
  return (spent / elapsedDays * windowDays).toFixed(2);
}

// Six most recent *completed* periods before `currentStart`, oldest first.
export function priorPeriodKeys(period: 'monthly' | 'yearly', currentStart: Date): string[] {
  const keys: string[] = [];
  if (period === 'monthly') {
    for (let i = 6; i >= 1; i--) {
      const d = new Date(Date.UTC(currentStart.getUTCFullYear(), currentStart.getUTCMonth() - i, 1));
      keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
  } else {
    for (let i = 6; i >= 1; i--) {
      keys.push(String(currentStart.getUTCFullYear() - i));
    }
  }
  return keys;
}

export function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / (values.length || 1);
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const v = values.reduce((sum, x) => sum + (x - m) ** 2, 0) / values.length;
  return Math.sqrt(v);
}

// Per-row annotation for the /budget response. Pulled out so the branchy
// history / anomaly / suggestedLimit gating is unit-testable in isolation.
export function annotateBudgetRow(input: {
  spent: number;
  limit: number;
  elapsedDays: number;
  windowDays: number;
  periodEndExclusive: Date;
  now: Date;
  historyValuesNum: number[];
}): {
  projected: string | null;
  history: { values: string[]; average: string; median: string } | null;
  anomaly: boolean;
  suggestedLimit: string | null;
} {
  const { spent, limit, elapsedDays, windowDays, periodEndExclusive, now, historyValuesNum } = input;

  const projected = computeProjected(spent, elapsedDays, windowDays, periodEndExclusive, now);
  const nonZeroCount = historyValuesNum.filter((v) => v > 0).length;

  const history = nonZeroCount >= 2
    ? {
        values: historyValuesNum.map((v) => v.toFixed(2)),
        average: mean(historyValuesNum).toFixed(2),
        median: median(historyValuesNum).toFixed(2),
      }
    : null;

  // Gate on nonZeroCount (not historyValuesNum.length, which is always 6 due
  // to zero-padding): stdev computed against a mostly-zero-padded array is
  // not a meaningful anomaly signal.
  const anomaly = history !== null
    && nonZeroCount >= 3
    && Math.abs(spent - mean(historyValuesNum)) > stdev(historyValuesNum);

  const overCount = historyValuesNum.filter((v) => v > limit).length;
  const underHalfCount = limit > 0
    ? historyValuesNum.filter((v) => v < limit * 0.5).length
    : 0;
  const medianValue = median(historyValuesNum);
  const proposedValue = Math.round(Math.round(medianValue) * 1.1);
  const suggestedLimit = history !== null
    && proposedValue > 0
    && (overCount >= 3 || underHalfCount >= 3)
    ? proposedValue.toFixed(2)
    : null;

  return { projected, history, anomaly, suggestedLimit };
}
