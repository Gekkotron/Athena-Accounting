// Frontend paint-safe fallback for user settings. Kept in sync with
// backend/src/domain/settings/defaults.ts — if they drift, the backend
// value wins on the first GET (see design doc).

export type DashboardRange = '1m' | '3m' | '6m' | '12m' | 'all';
// 'available' = aggregate only accounts whose lock has elapsed (or that
// have no lock). Resolved to an actual id list on the frontend via
// isAccountAvailable in pages/Dashboard/helpers.
export type DashboardChartScope = 'all' | 'available' | number;
export type TransactionsDefaultAccount = 'all' | 'first-checking' | number;

export interface CallMeBotPrefs {
  enabled: boolean;
  phone: string;
  apiKey: string;
  // Max CallMeBot sends per rolling 1-minute window; 0 = no limit. Only
  // automatic emissions are gated — a manual "Send a test" always goes
  // through.
  maxPerMinute: number;
}

export interface NotificationChannels {
  toast: boolean;
  osNative: boolean;
  webPush: boolean;
  callmebot: CallMeBotPrefs;
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
  channels?: {
    toast?: boolean;
    osNative?: boolean;
    webPush?: boolean;
    callmebot?: Partial<CallMeBotPrefs>;
  };
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

// Deep-merges a NotificationPrefsPatch on top of an existing NotificationPrefs
// value. Mirrors backend/src/domain/settings/schema.ts's NotificationsSchema,
// which merges each field individually rather than replacing whole sub-objects.
// Used by useSettings' optimistic update so a partial patch (e.g. one account
// threshold) doesn't wipe out the sibling fields — that would leave the
// Triggers card reading `.enabled` on undefined and crash the tree.
export function mergeNotifications(
  base: NotificationPrefs,
  patch: NotificationPrefsPatch | undefined,
): NotificationPrefs {
  if (!patch) return base;
  const t = patch.triggers;
  // Deep-merge callmebot so a one-field patch (e.g. toggling `enabled`) keeps
  // `phone`/`apiKey`. The other channels are plain booleans and merge fine
  // with the spread.
  const callmebot: CallMeBotPrefs = {
    enabled: patch.channels?.callmebot?.enabled ?? base.channels.callmebot.enabled,
    phone: patch.channels?.callmebot?.phone ?? base.channels.callmebot.phone,
    apiKey: patch.channels?.callmebot?.apiKey ?? base.channels.callmebot.apiKey,
    maxPerMinute:
      patch.channels?.callmebot?.maxPerMinute ?? base.channels.callmebot.maxPerMinute,
  };
  return {
    enabled: patch.enabled ?? base.enabled,
    channels: { ...base.channels, ...patch.channels, callmebot },
    privacy: { ...base.privacy, ...patch.privacy },
    triggers: {
      bigTransaction: { ...base.triggers.bigTransaction, ...t?.bigTransaction },
      accountLow: { ...base.triggers.accountLow, ...t?.accountLow },
      envelopeExceeded: { ...base.triggers.envelopeExceeded, ...t?.envelopeExceeded },
      bankSyncFailed: { ...base.triggers.bankSyncFailed, ...t?.bankSyncFailed },
    },
  };
}

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
    channels: {
      toast: true,
      osNative: false,
      webPush: false,
      callmebot: { enabled: false, phone: '', apiKey: '', maxPerMinute: 0 },
    },
    privacy: { hideAmount: true, hideMerchant: true },
    triggers: {
      bigTransaction: { enabled: true, thresholds: {} },
      accountLow: { enabled: true, floors: {} },
      envelopeExceeded: { enabled: true },
      bankSyncFailed: { enabled: true },
    },
  },
};
