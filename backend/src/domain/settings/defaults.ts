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
  // Transactions page pre-selects this account on load. 'first-checking'
  // means: auto-pick the earliest `type: 'checking'` account. Users can
  // pin a specific id or 'all' via Settings.
  transactionsDefaultAccount: 'first-checking',
  // Local hour (0-23, server clock) of the unattended bank sync. 02:00 by
  // default — banks have usually booked the previous day by then.
  bankSyncHour: 2,
  // Local hour (0-23, server clock) of the unattended remote backup.
  // 03:00 by default — after the 02:00 bank sync so the backup catches it.
  backupHour: 3,
  // Single currency all Dashboard/report totals convert to via the manual
  // fx_rates table. null = per-currency mode (no conversion, current
  // behavior).
  displayCurrency: null,
} as const;

export type DashboardRange = '30d' | '3m' | '6m' | '12m' | 'all';
export type DashboardChartScope = 'all' | number;
export type TransactionsDefaultAccount = 'all' | 'first-checking' | number;
export type DisplayCurrency = string | null;
