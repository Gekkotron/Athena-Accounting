import { z } from 'zod';
import { DEFAULTS } from './defaults.js';
import type {
  DashboardRange,
  DashboardChartScope,
  TransactionsDefaultAccount,
} from './defaults.js';

const AccountIdKeyed = z.record(z.string().regex(/^\d+$/), z.number().nonnegative());

const NotificationsSchema = z
  .object({
    enabled: z.boolean().optional(),
    channels: z
      .object({
        toast: z.boolean().optional(),
        osNative: z.boolean().optional(),
        webPush: z.boolean().optional(),
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
    dashboardRange: z.enum(['30d', '3m', '6m', '12m', 'all']).optional(),
    dashboardChartScope: z
      .union([z.literal('all'), z.number().int().positive()])
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
    channels: { toast: boolean; osNative: boolean; webPush: boolean };
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
  return {
    enabled: patch?.enabled ?? base.enabled,
    channels: { ...base.channels, ...patch?.channels },
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
