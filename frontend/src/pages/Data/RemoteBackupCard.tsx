import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { formatDateTime } from '../../lib/format';
import { useSettings } from '../../lib/useSettings';
import {
  buildPutPayload,
  isPlainHttp,
  type FormError,
  type RemoteBackupForm,
} from './remote-backup-lib';

interface DestinationStatus {
  configured: boolean;
  kind?: 'webdav' | 'folder' | 'ftp';
  config?: {
    url?: string;
    host?: string;
    port?: number;
    username?: string;
    subdir?: string | null;
    path?: string;
    keepLast?: number;
  };
  enabled?: boolean;
  lastRunAt?: string | null;
  lastError?: string | null;
  auto: { enabled: boolean; hour: number; nextAt: string | null };
}

const EMPTY_FORM: RemoteBackupForm = {
  kind: 'webdav',
  url: '',
  host: '',
  port: '21',
  username: '',
  password: '',
  subdir: '',
  path: '',
  keepLast: '30',
  passphrase: '',
};

const KIND_LABEL_KEYS = {
  webdav: 'backup.remote.kindWebdav',
  ftp: 'backup.remote.kindFtp',
  folder: 'backup.remote.kindFolder',
} as const;

// "Sauvegarde distante" card on the Sauvegarde page: configure a WebDAV or
// folder destination for scheduled encrypted backups, pick the hour, run
// one immediately. Secrets are write-only — the status never echoes them,
// so the password/passphrase fields always start blank.
export function RemoteBackupCard(): JSX.Element {
  const { t } = useTranslation('imports');
  const qc = useQueryClient();
  const { settings, isReady, mutation: settingsMut } = useSettings();

  const status = useQuery({
    queryKey: ['backup-destination'],
    queryFn: () => api<DestinationStatus>('/api/backup/destination'),
  });

  const [form, setForm] = useState<RemoteBackupForm>(EMPTY_FORM);
  const [hydrated, setHydrated] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Pre-fill the non-secret fields once from the stored destination; later
  // refetches must not clobber in-progress edits.
  useEffect(() => {
    const d = status.data;
    if (hydrated || !d?.configured || !d.kind || !d.config) return;
    setForm((f) => ({
      ...f,
      kind: d.kind!,
      url: d.config!.url ?? '',
      host: d.config!.host ?? '',
      port: String(d.config!.port ?? 21),
      username: d.config!.username ?? '',
      subdir: d.config!.subdir ?? '',
      path: d.config!.path ?? '',
      keepLast: String(d.config!.keepLast ?? 30),
    }));
    setHydrated(true);
  }, [status.data, hydrated]);

  const set = (patch: Partial<RemoteBackupForm>) => {
    setFormError(null);
    setForm((f) => ({ ...f, ...patch }));
  };

  const saveMut = useMutation({
    mutationFn: (payload: unknown) =>
      api<DestinationStatus>('/api/backup/destination', { method: 'PUT', json: payload }),
    onSuccess: () => {
      setForm((f) => ({ ...f, password: '', passphrase: '' }));
      qc.invalidateQueries({ queryKey: ['backup-destination'] });
    },
  });
  const runMut = useMutation({
    mutationFn: () =>
      api<{ filename: string }>('/api/backup/destination/run-now', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backup-destination'] }),
  });
  const deleteMut = useMutation({
    mutationFn: () => api('/api/backup/destination', { method: 'DELETE' }),
    onSuccess: () => {
      setConfirmDelete(false);
      setHydrated(false);
      setForm(EMPTY_FORM);
      qc.invalidateQueries({ queryKey: ['backup-destination'] });
    },
  });

  const save = () => {
    const built = buildPutPayload(form);
    if (!built.ok) {
      setFormError(built.error);
      return;
    }
    saveMut.mutate(built.payload);
  };

  const d = status.data;
  // The destination routes put the actionable part (connection refused,
  // authentication failed, …) in `detail` next to the generic `error` —
  // show both or the banner is useless for debugging.
  const describeError = (err: unknown): string | null => {
    if (!(err instanceof ApiError)) return null;
    const detail = (err.data as { detail?: string } | null | undefined)?.detail;
    return detail ? `${err.message} — ${detail}` : err.message;
  };
  const apiError = describeError(saveMut.error) ?? describeError(runMut.error);

  const field = (label: string, key: keyof RemoteBackupForm, type = 'text', extra?: object) => (
    <input
      type={type}
      className="input"
      aria-label={label}
      placeholder={label}
      value={form[key] as string}
      onChange={(e) => set({ [key]: e.target.value })}
      disabled={saveMut.isPending}
      {...extra}
    />
  );

  return (
    <section className="mt-8">
      <div className="section-rule mb-4">{t('backup.remote.sectionTitle')}</div>
      <div className="surface p-5 md:p-6 flex flex-col gap-4">
        <p className="text-sm text-ink-400 max-w-2xl">{t('backup.remote.description')}</p>

        <div className="flex items-center gap-4" role="radiogroup" aria-label={t('backup.remote.kindLabel')}>
          {(['webdav', 'ftp', 'folder'] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="remote-backup-kind"
                checked={form.kind === k}
                onChange={() => set({ kind: k })}
                disabled={saveMut.isPending}
              />
              {t(KIND_LABEL_KEYS[k])}
            </label>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-2 max-w-3xl">
          {form.kind === 'webdav' && (
            <>
              {field(t('backup.remote.url'), 'url')}
              {field(t('backup.remote.username'), 'username')}
              {field(t('backup.remote.password'), 'password', 'password')}
              {field(t('backup.remote.subdir'), 'subdir')}
            </>
          )}
          {form.kind === 'ftp' && (
            <>
              {field(t('backup.remote.host'), 'host')}
              {field(t('backup.remote.port'), 'port', 'text', { inputMode: 'numeric' })}
              {field(t('backup.remote.username'), 'username')}
              {field(t('backup.remote.password'), 'password', 'password')}
              {field(t('backup.remote.subdir'), 'subdir')}
            </>
          )}
          {form.kind === 'folder' && field(t('backup.remote.path'), 'path')}
          {field(t('backup.remote.keepLast'), 'keepLast', 'text', { inputMode: 'numeric' })}
          {field(t('backup.remote.passphrase'), 'passphrase', 'password')}
        </div>

        {form.kind === 'webdav' && isPlainHttp(form.url) && (
          <p className="text-xs text-clay-300">{t('backup.remote.httpWarning')}</p>
        )}
        {form.kind === 'ftp' && (
          <p className="text-xs text-clay-300">{t('backup.remote.ftpWarning')}</p>
        )}
        <p className="text-xs text-clay-300">{t('backup.remote.passphraseWarning')}</p>

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
          <button className="btn-primary" onClick={save} disabled={saveMut.isPending}>
            {saveMut.isPending ? t('backup.remote.saving') : t('backup.remote.save')}
          </button>
          {d?.configured && (
            <>
              <button
                className="btn-secondary"
                onClick={() => runMut.mutate()}
                disabled={runMut.isPending}
              >
                {runMut.isPending ? t('backup.remote.running') : t('backup.remote.runNow')}
              </button>
              <button
                className="text-sm text-clay-300 hover:text-clay-200 underline"
                onClick={() => setConfirmDelete(true)}
              >
                {t('backup.remote.delete')}
              </button>
            </>
          )}
        </div>

        {(formError || apiError) && (
          <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-4 py-3 text-sm text-clay-200">
            {formError ? t(`backup.remote.errors.${formError}`) : apiError}
          </div>
        )}

        {runMut.data && (
          <div className="rounded-lg border border-sage-800/50 bg-sage-900/15 px-4 py-3 text-sm text-sage-200">
            {t('backup.remote.runOk', { filename: runMut.data.filename })}
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
        open={confirmDelete}
        title={t('backup.remote.deleteConfirmTitle')}
        description={t('backup.remote.deleteConfirmDescription')}
        confirmLabel={t('backup.remote.deleteConfirmLabel')}
        destructive
        busy={deleteMut.isPending}
        onConfirm={() => deleteMut.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </section>
  );
}
