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
