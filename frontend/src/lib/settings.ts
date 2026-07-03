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
}

export const DEFAULTS: Settings = {
  dashboardRange: '3m',
  dashboardChartScope: 'all',
  chartGapThresholdDays: 6,
  duplicateSimilarityThreshold: 0,
};
