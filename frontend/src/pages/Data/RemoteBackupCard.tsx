import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorState, LoadingBlock } from '../../components/StateBlocks';
import { formatDateTime } from '../../lib/format';
import { useSettings } from '../../lib/useSettings';
import { RemoteBackupFields } from './RemoteBackupFields';
import { useRemoteBackupState } from './useRemoteBackupState';

// "Sauvegarde distante" card on the Sauvegarde page: configure a WebDAV or
// folder destination for scheduled encrypted backups, pick the hour, run
// one immediately. Secrets are write-only — the status never echoes them,
// so the password/passphrase fields always start blank.
export function RemoteBackupCard(): JSX.Element {
  const { t } = useTranslation('imports');
  const qc = useQueryClient();
  const { settings, isReady, mutation: settingsMut } = useSettings();
  const s = useRemoteBackupState();
  const d = s.status.data;

  // Silent-error guard: without this, a failed status fetch renders the
  // "first-time setup" form, which is destructive-looking to a user who has
  // already configured a destination.
  if (s.status.isLoading) {
    return (
      <section className="mt-8">
        <div className="section-rule mb-4">{t('backup.remote.sectionTitle')}</div>
        <LoadingBlock height="min-h-40" />
      </section>
    );
  }
  if (s.status.isError) {
    return (
      <section className="mt-8">
        <div className="section-rule mb-4">{t('backup.remote.sectionTitle')}</div>
        <ErrorState
          title={t('backup.remote.errorTitle')}
          error={s.status.error}
          onRetry={() => void s.status.refetch()}
        />
      </section>
    );
  }

  return (
    <section className="mt-8">
      <div className="section-rule mb-4">{t('backup.remote.sectionTitle')}</div>
      <div className="surface p-5 md:p-6 flex flex-col gap-4">
        <p className="text-sm text-ink-400 max-w-2xl">{t('backup.remote.description')}</p>

        <RemoteBackupFields
          form={s.form}
          set={s.set}
          configured={d?.configured ?? false}
          disabled={s.saveMut.isPending}
        />

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-ink-200">{t('backup.remote.hourLabel')}</span>
          <select
            className="input max-w-28"
            aria-label={t('backup.remote.hourLabel')}
            value={String(settings.backupHour)}
            disabled={!isReady || settingsMut.isPending}
            onChange={(e) =>
              settingsMut.mutate(
                { backupHour: Number(e.target.value) },
                { onSuccess: () => qc.invalidateQueries({ queryKey: ['backup-destination'] }) },
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

        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={s.save} disabled={s.saveMut.isPending}>
            {s.saveMut.isPending ? t('backup.remote.saving') : t('backup.remote.save')}
          </button>
          {d?.configured && (
            <>
              <button
                className="btn-secondary"
                onClick={() => s.runMut.mutate()}
                disabled={s.runMut.isPending}
              >
                {s.runMut.isPending ? t('backup.remote.running') : t('backup.remote.runNow')}
              </button>
              <button
                className="text-sm text-clay-300 hover:text-clay-200 underline"
                onClick={() => s.setConfirmDelete(true)}
              >
                {t('backup.remote.delete')}
              </button>
            </>
          )}
        </div>

        {(s.formError || s.apiError) && (
          <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-4 py-3 text-sm text-clay-200">
            {s.formError ? t(`backup.remote.errors.${s.formError}`) : s.apiError}
          </div>
        )}

        {s.runMut.data && (
          <div className="rounded-lg border border-sage-800/50 bg-sage-900/15 px-4 py-3 text-sm text-sage-200">
            {t('backup.remote.runOk', { filename: s.runMut.data.filename })}
          </div>
        )}

        {d?.configured && (
          <div className="flex flex-col gap-0.5 text-xs text-ink-400">
            <span>
              {d.lastRunAt
                ? t('backup.remote.lastRun', { date: formatDateTime(d.lastRunAt) })
                : t('backup.remote.neverRan')}
            </span>
            {d.auto.nextAt && (
              <span>{t('backup.remote.nextRun', { date: formatDateTime(d.auto.nextAt) })}</span>
            )}
            {d.lastError && <span className="text-clay-300">{d.lastError}</span>}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={s.confirmDelete}
        title={t('backup.remote.deleteConfirmTitle')}
        description={t('backup.remote.deleteConfirmDescription')}
        confirmLabel={t('backup.remote.deleteConfirmLabel')}
        destructive
        busy={s.deleteMut.isPending}
        onConfirm={() => s.deleteMut.mutate()}
        onCancel={() => s.setConfirmDelete(false)}
      />
    </section>
  );
}
