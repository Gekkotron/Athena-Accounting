// Frontend paint-safe fallback for user settings. Kept in sync with
// backend/src/domain/settings/defaults.ts — if they drift, the backend
// value wins on the first GET (see design doc).

export type DashboardRange = '30d' | '3m' | '6m' | '12m' | 'all';
export type DashboardChartScope = 'all' | number;

export interface Settings {
  dashboardRange: DashboardRange;
  dashboardChartScope: DashboardChartScope;
  chartGapThresholdDays: number;
  duplicateSimilarityThreshold: number;
  // Récurrent overlay on the Dashboard's Trend chart. When on, the chart
  // extends past today with a dashed projected line derived from active
  // recurring series.
  showForecast: boolean;
}

export const DEFAULTS: Settings = {
  dashboardRange: '3m',
  dashboardChartScope: 'all',
  chartGapThresholdDays: 6,
  duplicateSimilarityThreshold: 0,
  showForecast: false,
};
