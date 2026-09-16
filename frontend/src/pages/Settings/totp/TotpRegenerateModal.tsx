import { useEffect, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { regenerateRecoveryCodes } from '../../../api/totp';
import { describeTotpError } from './totp-errors';
import { RecoveryCodesView } from './RecoveryCodesView';

interface Props {
  open: boolean;
  onCancel: () => void;
  onCompleted: () => void;
}

export function TotpRegenerateModal({ open, onCancel, onCompleted }: Props) {
  const { t } = useTranslation('settings');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setError(null);
    setCodes(null);
  }, [open]);

  const mut = useMutation({
    mutationFn: (pw: string) => regenerateRecoveryCodes(pw),
    onSuccess: (data) => setCodes(data.recoveryCodes),
    onError: (err) => setError(describeTotpError(err, t, 'password')),
  });

  if (!open) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 1) return;
    setError(null);
    mut.mutate(password);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-ink-950/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('settings.twoFactor.regenerate.title')}
      onClick={onCancel}
    >
      <div className="surface w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        {codes ? (
          <div className="flex flex-col gap-4">
            <div className="display text-xl text-ink-50 leading-snug">
              {t('settings.twoFactor.enroll.step3Title')}
            </div>
            <RecoveryCodesView codes={codes} onDone={onCompleted} />
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="display text-xl text-ink-50 leading-snug">
              {t('settings.twoFactor.regenerate.title')}
            </div>
            <p className="text-sm text-ink-400">
              {t('settings.twoFactor.regenerate.description')}
            </p>
            <div>
              <label htmlFor="totp-regen-password" className="label mb-1.5 block">
                {t('settings.twoFactor.regenerate.passwordLabel')}
              </label>
              <input
                id="totp-regen-password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
                required
              />
            </div>
            {error && (
              <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={onCancel}>
                {t('cancel' as string, { defaultValue: 'Annuler', ns: 'common' })}
              </button>
              <button className="btn-primary" disabled={password.length < 1 || mut.isPending}>
                {t('settings.twoFactor.regenerate.submitButton')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
