import { z } from 'zod';
import { DEFAULTS } from './defaults.js';
import type {
  DashboardRange,
  DashboardChartScope,
  TransactionsDefaultAccount,
} from './defaults.js';

const AccountIdKeyed = z.record(z.string().regex(/^\d+$/), z.number().nonnegative());

// CallMeBot WhatsApp relay: user activates it by messaging the bot once from
// their phone, pastes the returned apikey here, and every notification is
// forwarded as a WhatsApp text. The apikey is a bearer token for *this user's*
// line only (worst case: someone with the key can send WhatsApp messages to
// you — annoying, not catastrophic), kept in the user's settings JSONB and
// never exposed outside the authenticated GET /api/settings response.
const CallMeBotSchema = z
  .object({
    enabled: z.boolean().optional(),
    phone: z.string().max(32).optional(),
    apiKey: z.string().max(128).optional(),
    // Max CallMeBot sends per rolling 1-minute window; 0 = no limit.
    // 1000/min cap keeps obviously-bogus values from blowing up the
    // timestamp buffer without rejecting the whole patch.
    maxPerMinute: z.number().int().min(0).max(1000).optional(),
  })
  .strict()
  .optional();

const NotificationsSchema = z
  .object({
    enabled: z.boolean().optional(),
    channels: z
      .object({
        toast: z.boolean().optional(),
        osNative: z.boolean().optional(),
        webPush: z.boolean().optional(),
        callmebot: CallMeBotSchema,
      })
      .partial()
      .optional(),
    privacy: z
      .object({
        hideAmount: z.boolean().optional(),
        hideMerchant: z.boolean().optional(),
      })
      .partial()
      .optional(),
    triggers: z
      .object({
        bigTransaction: z
          .object({ enabled: z.boolean().optional(), thresholds: AccountIdKeyed.optional() })
          .optional(),
        accountLow: z
          .object({ enabled: z.boolean().optional(), floors: AccountIdKeyed.optional() })
          .optional(),
        envelopeExceeded: z.object({ enabled: z.boolean().optional() }).optional(),
        bankSyncFailed: z.object({ enabled: z.boolean().optional() }).optional(),
      })
      .partial()
      .optional(),
  })
  .strict();

type NotificationsPatch = z.infer<typeof NotificationsSchema>;

export const SettingsSchema = z
  .object({
    // `'30d'` is a legacy value from when the shortest range was a rolling
    // 30-day window. It is now the previous complete calendar month; the
    // transform normalizes any stored `'30d'` to `'1m'` so a settings GET
    // never returns the removed literal (which would trip the frontend
    // union type).
    dashboardRange: z
      .enum(['1m', '3m', '6m', '12m', 'all', '30d'])
      .transform((v) => (v === '30d' ? ('1m' as const) : v))
      .optional(),
    dashboardChartScope: z
      .union([z.literal('all'), z.literal('available'), z.number().int().positive()])
      .optional(),
    chartGapThresholdDays: z.number().int().min(1).max(60).optional(),
    duplicateSimilarityThreshold: z.number().int().min(0).max(100).optional(),
    showForecast: z.boolean().optional(),
    transactionsDefaultAccount: z
      .union([
        z.literal('all'),
        z.literal('first-checking'),
        z.number().int().positive(),
      ])
      .optional(),
    bankSyncHour: z.number().int().min(0).max(23).optional(),
    backupHour: z.number().int().min(0).max(23).optional(),
    displayCurrency: z
      .union([z.string().regex(/^[A-Z]{3}$/), z.null()])
      .optional(),
    notifications: NotificationsSchema.optional(),
  })
  .strict();

export type Settings = z.infer<typeof SettingsSchema>;

export type FullSettings = {
  dashboardRange: DashboardRange;
  dashboardChartScope: DashboardChartScope;
  chartGapThresholdDays: number;
  duplicateSimilarityThreshold: number;
  showForecast: boolean;
  transactionsDefaultAccount: TransactionsDefaultAccount;
  bankSyncHour: number;
  backupHour: number;
  displayCurrency: string | null;
  notifications: {
    enabled: boolean;
    channels: {
      toast: boolean;
      osNative: boolean;
      webPush: boolean;
      callmebot: { enabled: boolean; phone: string; apiKey: string; maxPerMinute: number };
    };
    privacy: { hideAmount: boolean; hideMerchant: boolean };
    triggers: {
      bigTransaction: { enabled: boolean; thresholds: Record<string, number> };
      accountLow: { enabled: boolean; floors: Record<string, number> };
      envelopeExceeded: { enabled: boolean };
      bankSyncFailed: { enabled: boolean };
    };
  };
};

// Deep-merges a partial `notifications` patch onto a complete base, field by
// field at every level. `Object.assign` can't be used for this key: it would
// replace the whole sub-object with whatever partial shape was stored,
// wiping sibling fields (e.g. storing only `channels.webPush` would erase
// `enabled`, `privacy`, and `triggers`). `thresholds`/`floors` are
// account-id-keyed maps — when present in the patch they are used as-is
// (the base default is always `{}`, so this is still a merge onto it).
// Every container in the returned value is freshly constructed (never
// `base` or one of its nested objects/maps returned by reference) so a
// caller mutating the result can never reach back into `DEFAULTS`.
export function mergeNotifications(
  base: FullSettings['notifications'],
  patch: NotificationsPatch | undefined,
): FullSettings['notifications'] {
  // `channels.callmebot` is the only nested object inside `channels`; the
  // other channels (`toast`, `osNative`, `webPush`) are booleans and merge
  // field-wise via the spread. For callmebot, do a per-field merge so a patch
  // that only toggles `enabled` doesn't wipe `phone`/`apiKey` (and vice versa).
  const basePatchChannels = { ...base.channels, ...patch?.channels };
  const patchedCallmebot = {
    enabled: patch?.channels?.callmebot?.enabled ?? base.channels.callmebot.enabled,
    phone: patch?.channels?.callmebot?.phone ?? base.channels.callmebot.phone,
    apiKey: patch?.channels?.callmebot?.apiKey ?? base.channels.callmebot.apiKey,
    maxPerMinute:
      patch?.channels?.callmebot?.maxPerMinute ?? base.channels.callmebot.maxPerMinute,
  };
  return {
    enabled: patch?.enabled ?? base.enabled,
    channels: { ...basePatchChannels, callmebot: patchedCallmebot },
    privacy: { ...base.privacy, ...patch?.privacy },
    triggers: {
      bigTransaction: {
        enabled: patch?.triggers?.bigTransaction?.enabled ?? base.triggers.bigTransaction.enabled,
        thresholds: { ...(patch?.triggers?.bigTransaction?.thresholds ?? base.triggers.bigTransaction.thresholds) },
      },
      accountLow: {
        enabled: patch?.triggers?.accountLow?.enabled ?? base.triggers.accountLow.enabled,
        floors: { ...(patch?.triggers?.accountLow?.floors ?? base.triggers.accountLow.floors) },
      },
      envelopeExceeded: {
        enabled: patch?.triggers?.envelopeExceeded?.enabled ?? base.triggers.envelopeExceeded.enabled,
      },
      bankSyncFailed: {
        enabled: patch?.triggers?.bankSyncFailed?.enabled ?? base.triggers.bankSyncFailed.enabled,
      },
    },
  };
}

// Merges DEFAULTS <- stored (unvalidated JSONB) <- patch. `stored` is
// treated as untrusted input — unknown keys are dropped, invalid values
// fall back to their default. This is the last line of defense: even if
// something outside PATCH wrote garbage into the JSONB, GET returns a
// clean, complete shape.
export function mergeSettings(stored: unknown, patch: Partial<Settings> = {}): FullSettings {
  const safe: FullSettings = { ...DEFAULTS };
  const src = (stored && typeof stored === 'object') ? (stored as Record<string, unknown>) : {};
  const parsed = SettingsSchema.safeParse(src);
  if (parsed.success) {
    const { notifications: storedNotifications, ...rest } = parsed.data;
    Object.assign(safe, rest);
    safe.notifications = mergeNotifications(safe.notifications, storedNotifications);
  }
  // patch has already been validated by the caller.
  const { notifications: patchNotifications, ...restPatch } = patch;
  Object.assign(safe, restPatch);
  safe.notifications = mergeNotifications(safe.notifications, patchNotifications);
  return safe;
}
