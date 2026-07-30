import type { RecurringSeries } from '../../api/types';
import { toLocalIso, todayLocalIso } from '../../lib/dates';

export type Horizon = 30 | 60 | 90 | 180;
export const HORIZONS: Horizon[] = [30, 60, 90, 180];

// Historical window shown on the chart before the projection kicks in.
export const HISTORICAL_WINDOW_DAYS = 90;

// Local calendar day — a UTC day would start the projection on tomorrow's
// date for evening users east of Greenwich.
export function todayIso(): string {
  return todayLocalIso();
}

export function isoDaysAgo(days: number): string {
  return toLocalIso(new Date(Date.now() - days * 86_400_000));
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
