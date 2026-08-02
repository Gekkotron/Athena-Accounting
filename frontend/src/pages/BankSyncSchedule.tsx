import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../lib/useSettings';
import { formatDateTime } from '../lib/format';
import type { BankSyncAutoInfo } from './SettingsBankSync-lib';

// Auto-sync schedule block of the bank-sync tab: pick the retrieval hour
// (stored in user settings, applied by the backend scheduler) and show the
// previous / next unattended fetch. The next-occurrence timestamp is
// computed server-side (server clock is what the scheduler runs on), so a
// saved hour change refreshes the status query to get the recomputed value.
export function BankSyncSchedule({ auto }: { auto: BankSyncAutoInfo | undefined }): JSX.Element {
  const { t } = useTranslation('settings');
  const qc = useQueryClient();
  const { settings, isReady, mutation } = useSettings();

  return (
    <div data-testid="bank-sync-schedule" className="rounded-lg border border-ink-800/60 p-3 flex flex-col gap-2">
      <div className="label">{t('settings.bankSync.schedule.label')}</div>
      {auto && !auto.enabled ? (
        <p className="text-sm text-ink-400">{t('settings.bankSync.schedule.disabled')}</p>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-ink-200">{t('settings.bankSync.schedule.hourLabel')}</span>
            <select
              className="input max-w-28"
              aria-label={t('settings.bankSync.schedule.hourLabel')}
              value={String(settings.bankSyncHour)}
              disabled={!isReady || mutation.isPending}
              onChange={(e) =>
                mutation.mutate(
                  { bankSyncHour: Number(e.target.value) },
                  {
                    onSuccess: () => qc.invalidateQueries({ queryKey: ['bank-sync-status'] }),
                  },
                )
              }
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {`${String(h).padStart(2, '0')}:00`}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-0.5 text-xs text-ink-400">
            <span>
              {auto?.lastSyncedAt
                ? t('settings.bankSync.schedule.lastRun', { date: formatDateTime(auto.lastSyncedAt) })
                : t('settings.bankSync.schedule.neverRun')}
            </span>
            {auto?.nextAt && (
              <span>{t('settings.bankSync.schedule.nextRun', { date: formatDateTime(auto.nextAt) })}</span>
            )}
            <span>{t('settings.bankSync.schedule.hint')}</span>
          </div>
        </>
      )}
    </div>
  );
}
