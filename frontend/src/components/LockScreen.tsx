import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import { useLock, LOCK_FLAG_KEY, type LockStatus } from '../contexts/LockContext';

// Full-viewport lock overlay. Rendered above the whole app while locked;
// unlocking re-verifies the password server-side, so state beneath the
// overlay (page, filters, drafts) survives untouched.
export function LockScreen({ username }: { username: string }) {
  const { locked, unlock } = useLock();
  const { t } = useTranslation('layout');
  const qc = useQueryClient();
  const mode = qc.getQueryData<LockStatus>(['lock-status'])?.mode ?? 'session';

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const logout = useMutation({
    mutationFn: () => api<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      localStorage.removeItem(LOCK_FLAG_KEY);
      qc.clear();
      qc.setQueryData(['me'], { user: null });
    },
  });

  if (!locked) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(password);
      setPassword('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError(t('lock.rateLimited'));
      } else if (err instanceof ApiError && err.status === 401 && err.message === 'authentication required') {
        // Session died while idle — fall back to the login screen.
        qc.clear();
        qc.setQueryData(['me'], { user: null });
        return;
      } else {
        setError(t('lock.wrongPassword'));
      }
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('lock.screenTitle')}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-950/95 backdrop-blur"
    >
      <form onSubmit={submit} className="surface w-full max-w-xs p-6 text-center">
        <h1 className="text-lg font-semibold text-ink-50 mb-1">{t('lock.screenTitle')}</h1>
        <p className="text-sm text-ink-400 mb-4">{username}</p>
        <label htmlFor="lock-password" className="label mb-1.5 block text-left">
          {t('lock.passwordLabel')}
        </label>
        <input
          id="lock-password"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input mb-3"
        />
        {error && (
          <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200 mb-3">
            {error}
          </div>
        )}
        <button className="btn-primary w-full" disabled={busy || !password}>
          {t('lock.unlock')}
        </button>
        {mode === 'session' ? (
          <button
            type="button"
            className="btn-ghost w-full justify-center text-xs mt-3"
            onClick={() => logout.mutate()}
          >
            {t('user.logout')}
          </button>
        ) : (
          <p className="text-xs text-ink-400 mt-3">{t('lock.forgotHint')}</p>
        )}
      </form>
    </div>
  );
}
