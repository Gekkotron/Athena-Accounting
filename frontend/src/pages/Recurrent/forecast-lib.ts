import type { RecurringSeries } from '../../api/types';

export type Horizon = 30 | 60 | 90 | 180;
export const HORIZONS: Horizon[] = [30, 60, 90, 180];

// Historical window shown on the chart before the projection kicks in.
export const HISTORICAL_WINDOW_DAYS = 90;

export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function isoDaysAgo(days: number): string {
  const d = new Date();
  const t = d.getTime() - days * 86_400_000;
  const dt = new Date(t);
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// Series feeding the projection counter. `activeSeries` is already
// filtered to non-dismissed; this narrows again to confirmed-only unless
// the user opts in to detected-too. Kept as a pure function so the tab
// body can rely on the same predicate the debug panel does.
export function contributingSeries(
  activeSeries: RecurringSeries[],
  includeDetected: boolean,
): RecurringSeries[] {
  return activeSeries.filter((s) => includeDetected || s.status === 'confirmed');
}

// The empty-state trichotomy used by the tab. Returning null when the
// projection has at least one contributor lets the caller `if (kind !== null)`
// render the chart and stat tiles.
export type EmptyKind = null | 'scope' | 'unconfirmed' | 'none';

export function classifyEmpty(input: {
  contributingCount: number;
  scope: 'all' | number;
  allUserSeriesCount: number;
  activeSeriesCount: number;
  includeDetected: boolean;
}): EmptyKind {
  if (input.contributingCount > 0) return null;
  if (input.scope !== 'all' && input.allUserSeriesCount > 0) return 'scope';
  if (input.activeSeriesCount > 0 && !input.includeDetected) return 'unconfirmed';
  return 'none';
}
