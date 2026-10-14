import type { InvestmentsTimeseries } from '../../../api/investments';

export interface PlacementPoint {
  date: string;
  contributed: number;
  value: number;
  gain: number;
  estimated: boolean;
  unmapped: string[];
}

// `value` doubles as the chart's primary sample so the shared BalanceChart
// interaction hook (hover snapping, zoom) works on these points unchanged.
export interface PlacementSeries {
  currency: string;
  points: PlacementPoint[];
}

// Consolidated points win when the server sent them (display currency set);
// otherwise fall back to one currency's per-currency points — the preferred
// currency if it has data, else the first currency present.
export function pickPlacementSeries(
  data: InvestmentsTimeseries | undefined,
  preferredCurrency: string | undefined,
): PlacementSeries | null {
  if (!data) return null;
  if (data.consolidated && data.consolidated.points.length > 0) {
    return {
      currency: data.consolidated.display,
      points: data.consolidated.points.map((p) => ({
        date: p.bucket,
        contributed: Number(p.contributed),
        value: Number(p.value),
        gain: Number(p.gain),
        estimated: p.estimated,
        unmapped: p.unmapped,
      })),
    };
  }
  if (data.points.length === 0) return null;
  const currency =
    preferredCurrency && data.points.some((p) => p.currency === preferredCurrency)
      ? preferredCurrency
      : data.points[0]!.currency;
  return {
    currency,
    points: data.points
      .filter((p) => p.currency === currency)
      .map((p) => ({
        date: p.bucket,
        contributed: Number(p.contributed),
        value: Number(p.value),
        gain: Number(p.gain),
        estimated: p.estimated,
        unmapped: [],
      })),
  };
}

export interface PlacementSummary {
  value: number;
  contributed: number;
  gain: number;
  // Ratio (0.05 = +5 %), null when nothing was contributed.
  gainPct: number | null;
}

export function summarizePlacements(points: PlacementPoint[]): PlacementSummary | null {
  const last = points[points.length - 1];
  if (!last) return null;
  return {
    value: last.value,
    contributed: last.contributed,
    gain: last.gain,
    gainPct: last.contributed > 0 ? last.gain / last.contributed : null,
  };
}

// Month buckets are the 1st of the month but hold end-of-month values; the
// chart uses day granularity for short ranges and month for long ones.
export function granularityFor(range: string): 'day' | 'month' {
  return range === '12m' || range === 'all' ? 'month' : 'day';
}
