import { useEffect, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { disableTotp } from '../../../api/totp';
import { describeTotpError } from './totp-errors';

interface Props {
  open: boolean;
  onCancel: () => void;
  onDisabled: () => void;
}

export function TotpDisableModal({ open, onCancel, onDisabled }: Props) {
  const { t } = useTranslation('settings');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setCode('');
    setError(null);
  }, [open]);

  const mut = useMutation({
    mutationFn: (input: { password: string; code: string }) => disableTotp(input),
    onSuccess: () => onDisabled(),
    onError: (err) => setError(describeTotpError(err, t, 'either')),
  });

  if (!open) return null;

  const valid = password.length >= 1 && code.trim().length >= 6;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setError(null);
    mut.mutate({ password, code: code.trim() });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-ink-950/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('settings.twoFactor.disable.title')}
      onClick={onCancel}
    >
      <div className="surface w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="display text-xl text-ink-50 leading-snug">
            {t('settings.twoFactor.disable.title')}
          </div>
          <p className="text-sm text-ink-400">
            {t('settings.twoFactor.disable.description')}
          </p>
          <div>
            <label htmlFor="totp-disable-password" className="label mb-1.5 block">
              {t('settings.twoFactor.disable.passwordLabel')}
            </label>
            <input
              id="totp-disable-password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
          </div>
          <div>
            <label htmlFor="totp-disable-code" className="label mb-1.5 block">
              {t('settings.twoFactor.disable.codeLabel')}
            </label>
            <input
              id="totp-disable-code"
              type="text"
              className="input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              inputMode="text"
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
            <button className="btn-danger" disabled={!valid || mut.isPending}>
              {t('settings.twoFactor.disable.submitButton')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
