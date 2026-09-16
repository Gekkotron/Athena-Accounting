import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import type { User } from '../api/types';
import { verifyTotp } from '../api/totp';

interface Props {
  onAuthed: (data: { user: User }) => void;
  onSessionExpired: (message: string) => void;
}

// The second step of the login flow when the account has TOTP enabled.
// Accepts either a 6-digit TOTP code or a recovery code, and includes an
// escape-hatch logout link for "wrong account" recovery. A 401 with an
// error string other than "invalid code" is treated as a stale half-auth
// session and bounces back to step 1 via onSessionExpired.
export function LoginTotpStep({ onAuthed, onSessionExpired }: Props) {
  const { t } = useTranslation('settings');
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const verifyMut = useMutation({
    mutationFn: (raw: string) => verifyTotp(raw),
    onSuccess: onAuthed,
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          setError(t('login.totp.rateLimitedError'));
          return;
        }
        if (err.status === 401) {
          const body = err.data as { error?: string } | null;
          if (body?.error === 'invalid code') {
            setError(t('login.totp.invalidCodeError'));
            return;
          }
          onSessionExpired(t('login.totp.sessionExpiredError'));
          return;
        }
      }
      setError(t('login.totp.invalidCodeError'));
    },
  });

  const logoutMut = useMutation({
    mutationFn: () => api<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
    onSettled: () => onSessionExpired(''),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const raw = code.trim();
    if (raw.length < 6) return;
    setError(null);
    verifyMut.mutate(raw);
  };

  const isTotp = !useRecovery;
  const inputId = 'login-totp-code';

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-ink-50 mb-1">
          {t('login.totp.title')}
        </h1>
        <p className="text-sm text-ink-400">
          {t('login.totp.subtitle')}
        </p>
      </div>
      <div>
        <label className="label mb-1.5 block" htmlFor={inputId}>
          {isTotp ? t('login.totp.codeLabel') : t('login.totp.recoveryCodeLabel')}
        </label>
        <input
          id={inputId}
          key={isTotp ? 'totp' : 'recovery'}
          type="text"
          className="input tracking-widest"
          value={code}
          onChange={(e) => {
            const next = isTotp
              ? e.target.value.replace(/\D/g, '').slice(0, 6)
              : e.target.value.slice(0, 20);
            setCode(next);
          }}
          autoComplete="one-time-code"
          inputMode={isTotp ? 'numeric' : 'text'}
          placeholder={isTotp
            ? t('login.totp.codePlaceholder')
            : t('login.totp.recoveryCodePlaceholder')}
          autoFocus
          required
        />
      </div>
      {error && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
          {error}
        </div>
      )}
      <button
        className="btn-primary w-full"
        disabled={verifyMut.isPending || code.trim().length < 6}
      >
        {verifyMut.isPending
          ? t('login.form.submitting')
          : t('login.totp.submitButton')}
      </button>
      <div className="flex flex-col gap-2 text-center text-sm">
        <button
          type="button"
          className="text-sage-300 hover:text-sage-200 underline-offset-2 hover:underline"
          onClick={() => {
            setUseRecovery((v) => !v);
            setCode('');
            setError(null);
          }}
        >
          {isTotp
            ? t('login.totp.useRecoveryCodeLink')
            : t('login.totp.useTotpCodeLink')}
        </button>
        <button
          type="button"
          className="text-ink-500 hover:text-ink-300 underline-offset-2 hover:underline"
          onClick={() => logoutMut.mutate()}
          disabled={logoutMut.isPending}
        >
          {t('login.totp.logoutLink')}
        </button>
      </div>
    </form>
  );
}
