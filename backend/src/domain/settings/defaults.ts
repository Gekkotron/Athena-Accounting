// Canonical default values for user_settings. Backend is the source of
// truth for defaults; the frontend duplicates these under
// frontend/src/lib/settings.ts as a paint-safe fallback (see the design
// doc for why cross-side drift is self-healing).

export const DEFAULTS = {
  dashboardRange: '3m',
  dashboardChartScope: 'all',
  chartGapThresholdDays: 6,
  duplicateSimilarityThreshold: 0,
  // Récurrent → Dashboard Trend chart projection overlay. Off by default
  // so existing users see the same chart until they opt in.
  showForecast: false,
} as const;

export type DashboardRange = '30d' | '3m' | '6m' | '12m' | 'all';
export type DashboardChartScope = 'all' | number;
