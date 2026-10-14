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

// Point rebased on a window start: `contributed` is the Versé line level
// (start Valeur + deposits since), `gain` the gain made since the start and
// `deposits` the net deposits since the start.
export interface WindowPoint extends PlacementPoint {
  deposits: number;
}

// First and last point indexes inside the zoom window (whole series unzoomed).
export function visibleWindow(
  points: PlacementPoint[],
  zoom: { startMs: number; endMs: number } | null,
): { startIdx: number; endIdx: number } {
  const last = points.length - 1;
  if (!zoom || last < 0) return { startIdx: 0, endIdx: Math.max(last, 0) };
  let startIdx = points.findIndex((p) => Date.parse(p.date) >= zoom.startMs);
  if (startIdx === -1) startIdx = last;
  let endIdx = last;
  while (endIdx > startIdx && Date.parse(points[endIdx]!.date) > zoom.endMs) endIdx--;
  return { startIdx, endIdx };
}

// Rebases the series on points[startIdx] so the gain area and figures cover
// only the visible window: the Versé line restarts at that point's Valeur and
// grows with later deposits, so Valeur - Versé is the gain made since.
// `fromOrigin` (whole history, unzoomed) rebases on zero, keeping the
// lifetime figures.
export function rebasePlacements(points: PlacementPoint[], startIdx: number, fromOrigin: boolean): WindowPoint[] {
  const base = fromOrigin ? { value: 0, contributed: 0, gain: 0 } : points[startIdx];
  if (!base) return [];
  return points.map((p) => {
    const deposits = p.contributed - base.contributed;
    return { ...p, contributed: base.value + deposits, gain: p.gain - base.gain, deposits };
  });
}

export interface PlacementSummary {
  value: number;
  // Net deposits over the window.
  deposits: number;
  gain: number;
  // Ratio (0.05 = +5 %) of the gain to the capital engaged (start Valeur +
  // deposits), null when that capital is not positive.
  gainPct: number | null;
}

export function summarizePlacements(points: WindowPoint[]): PlacementSummary | null {
  const last = points[points.length - 1];
  if (!last) return null;
  return {
    value: last.value,
    deposits: last.deposits,
    gain: last.gain,
    gainPct: last.contributed > 0 ? last.gain / last.contributed : null,
  };
}

// Month buckets are the 1st of the month but hold end-of-month values; the
// chart uses day granularity for short ranges and month for long ones.
export function granularityFor(range: string): 'day' | 'month' {
  return range === '12m' || range === 'all' ? 'month' : 'day';
}
