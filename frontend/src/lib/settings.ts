// Frontend paint-safe fallback for user settings. Kept in sync with
// backend/src/domain/settings/defaults.ts — if they drift, the backend
// value wins on the first GET (see design doc).

export type DashboardRange = '30d' | '3m' | '6m' | '12m' | 'all';
export type DashboardChartScope = 'all' | number;
export type TransactionsDefaultAccount = 'all' | 'first-checking' | number;

export interface NotificationChannels {
  toast: boolean;
  osNative: boolean;
  webPush: boolean;
}

export interface NotificationPrivacy {
  hideAmount: boolean;
  hideMerchant: boolean;
}

export interface NotificationTriggers {
  bigTransaction: { enabled: boolean; thresholds: Record<string, number> };
  accountLow: { enabled: boolean; floors: Record<string, number> };
  envelopeExceeded: { enabled: boolean };
  bankSyncFailed: { enabled: boolean };
}

export interface NotificationPrefs {
  enabled: boolean;
  channels: NotificationChannels;
  privacy: NotificationPrivacy;
  triggers: NotificationTriggers;
}

// Deep-partial patch shape accepted by PATCH /api/settings for the
// `notifications` key — mirrors backend/src/domain/settings/schema.ts's
// NotificationsSchema, which merges each field individually rather than
// replacing whole sub-objects.
export interface NotificationPrefsPatch {
  enabled?: boolean;
  channels?: Partial<NotificationChannels>;
  privacy?: Partial<NotificationPrivacy>;
  triggers?: {
    bigTransaction?: Partial<NotificationTriggers['bigTransaction']>;
    accountLow?: Partial<NotificationTriggers['accountLow']>;
    envelopeExceeded?: Partial<NotificationTriggers['envelopeExceeded']>;
    bankSyncFailed?: Partial<NotificationTriggers['bankSyncFailed']>;
  };
}

export interface Settings {
  dashboardRange: DashboardRange;
  dashboardChartScope: DashboardChartScope;
  chartGapThresholdDays: number;
  duplicateSimilarityThreshold: number;
  // Récurrent overlay on the Dashboard's Trend chart. When on, the chart
  // extends past today with a dashed projected line derived from active
  // recurring series.
  showForecast: boolean;
  // Transactions page pre-selects this account on load. 'first-checking'
  // means: auto-pick the earliest `type: 'checking'` account. Users can
  // pin a specific id or 'all' via Settings.
  transactionsDefaultAccount: TransactionsDefaultAccount;
  // Local hour (0-23, server clock) of the unattended bank sync.
  bankSyncHour: number;
  // Local hour (0-23, server clock) of the unattended remote backup.
  backupHour: number;
  // 3-letter uppercase ISO currency code multi-currency totals are
  // consolidated into, or null to keep reports split per-currency.
  displayCurrency: string | null;
  notifications: NotificationPrefs;
}

// PATCH payload shape: every top-level field stays a flat optional (as
// before) except `notifications`, which accepts the deep-partial shape
// above so a single toggle can patch one field without re-sending the
// whole notifications tree.
export type SettingsPatch = Partial<Omit<Settings, 'notifications'>> & {
  notifications?: NotificationPrefsPatch;
};

export const DEFAULTS: Settings = {
  dashboardRange: '3m',
  dashboardChartScope: 'all',
  chartGapThresholdDays: 6,
  duplicateSimilarityThreshold: 0,
  showForecast: false,
  transactionsDefaultAccount: 'first-checking',
  bankSyncHour: 2,
  backupHour: 3,
  displayCurrency: null,
  notifications: {
    enabled: true,
    channels: { toast: true, osNative: false, webPush: false },
    privacy: { hideAmount: true, hideMerchant: true },
    triggers: {
      bigTransaction: { enabled: true, thresholds: {} },
      accountLow: { enabled: true, floors: {} },
      envelopeExceeded: { enabled: true },
      bankSyncFailed: { enabled: true },
    },
  },
};
