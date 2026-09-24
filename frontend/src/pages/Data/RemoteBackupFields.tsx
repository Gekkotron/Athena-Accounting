import { useTranslation } from 'react-i18next';
import { isPlainHttp, type RemoteBackupForm } from './remote-backup-lib';

const KIND_LABEL_KEYS = {
  webdav: 'backup.remote.kindWebdav',
  ftp: 'backup.remote.kindFtp',
  folder: 'backup.remote.kindFolder',
} as const;

export function RemoteBackupFields({
  form,
  set,
  configured,
  disabled,
}: {
  form: RemoteBackupForm;
  set: (patch: Partial<RemoteBackupForm>) => void;
  configured: boolean;
  disabled: boolean;
}): JSX.Element {
  const { t } = useTranslation('imports');

  const field = (label: string, key: keyof RemoteBackupForm, type = 'text', extra?: object) => {
    // Secrets are write-only: once configured, an empty field keeps the
    // stored value — say so in the placeholder instead of demanding a
    // retype on every edit.
    const keepHint =
      configured && (key === 'password' || key === 'passphrase')
        ? `${label} — ${t('backup.remote.keepStored')}`
        : label;
    return (
      <input
        type={type}
        className="input"
        aria-label={label}
        placeholder={keepHint}
        value={form[key] as string}
        onChange={(e) => set({ [key]: e.target.value })}
        disabled={disabled}
        {...extra}
      />
    );
  };

  return (
    <>
      <div className="flex items-center gap-4" role="radiogroup" aria-label={t('backup.remote.kindLabel')}>
        {(['webdav', 'ftp', 'folder'] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="remote-backup-kind"
              checked={form.kind === k}
              onChange={() => set({ kind: k })}
              disabled={disabled}
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
    </>
  );
}
