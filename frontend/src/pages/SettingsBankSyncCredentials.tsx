import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';

function describeSaveError(err: unknown, t: (key: string) => string): string {
  if (err instanceof ApiError) {
    if (err.message === 'invalid private key') return t('settings.bankSync.errors.invalidKey');
    if (err.status === 502) return t('settings.bankSync.errors.rejected');
  }
  return t('settings.bankSync.errors.generic');
}

// Credentials form shown while bank sync is unconfigured. The PUT validates
// the pair live against Enable Banking before storing.
export function SettingsBankSyncCredentials({
  redirectUrl,
  onSaved,
}: {
  redirectUrl: string;
  onSaved: () => void;
}): JSX.Element {
  const { t } = useTranslation('settings');
  const [applicationId, setApplicationId] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveMut = useMutation({
    mutationFn: (input: { applicationId: string; privateKey: string }) =>
      api('/api/bank-sync/credentials', { method: 'PUT', json: input }),
    onSuccess: () => {
      setApplicationId('');
      setPrivateKey('');
      setSaveError(null);
      onSaved();
    },
    onError: (err) => setSaveError(describeSaveError(err, t)),
  });

  const saveValid = applicationId.trim().length > 0 && privateKey.trim().length > 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!saveValid || saveMut.isPending) return;
    saveMut.mutate({ applicationId: applicationId.trim(), privateKey: privateKey.trim() });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-sm text-ink-400">{t('settings.bankSync.guide')}</p>
      <p className="text-sm text-ink-400">
        {t('settings.bankSync.redirectUrlLabel')}{' '}
        <code className="text-ink-200 break-all">{redirectUrl}</code>
      </p>
      <div>
        <label htmlFor="bank-sync-app-id" className="label mb-1.5 block">
          {t('settings.bankSync.applicationIdLabel')}
        </label>
        <input
          id="bank-sync-app-id"
          type="text"
          className="input"
          value={applicationId}
          onChange={(e) => setApplicationId(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div>
        <label htmlFor="bank-sync-private-key" className="label mb-1.5 block">
          {t('settings.bankSync.privateKeyLabel')}
        </label>
        <textarea
          id="bank-sync-private-key"
          className="input min-h-28 font-mono text-xs"
          value={privateKey}
          onChange={(e) => setPrivateKey(e.target.value)}
          placeholder={t('settings.bankSync.privateKeyPlaceholder')}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {saveError && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
          {saveError}
        </div>
      )}
      <button className="btn-primary" disabled={!saveValid || saveMut.isPending}>
        {t('settings.bankSync.saveButton')}
      </button>
    </form>
  );
}
