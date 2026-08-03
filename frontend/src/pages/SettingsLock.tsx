import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import type { LockStatus } from '../contexts/LockContext';

// Desktop-only (AUTH_MODE=none) lock password management. On the LAN build
// the account password is the lock and this card renders nothing.
export function SettingsLock() {
  const { t } = useTranslation('settings');
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['lock-status'],
    queryFn: () => api<LockStatus>('/api/auth/lock-status'),
    staleTime: Infinity,
  });

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (json: { currentPassword?: string; newPassword?: string }) =>
      api<{ lockConfigured: boolean }>('/api/auth/lock-password', { method: 'PUT', json }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['lock-status'] });
      setOk(t(vars.newPassword ? 'lock.saved' : 'lock.removed'));
      setCurrent(''); setNext(''); setConfirm('');
    },
    onError: (err: ApiError) => setError(err.message),
  });

  if (!status.data || status.data.mode !== 'none') return null;
  const configured = status.data.lockConfigured;

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null); setOk(null);
    if (configured && !current) { setError(t('lock.errors.currentRequired')); return; }
    if (next.length < 8) { setError(t('lock.errors.tooShort')); return; }
    if (next !== confirm) { setError(t('lock.errors.mismatch')); return; }
    mut.mutate(configured ? { currentPassword: current, newPassword: next } : { newPassword: next });
  }

  function remove() {
    setError(null); setOk(null);
    mut.mutate({ currentPassword: current });
  }

  return (
    <section className="flex flex-col gap-4 pt-4 border-t border-ink-800/60">
      <div>
        <div className="label">{t('lock.title')}</div>
        <p className="text-sm text-ink-400 mt-1">{t('lock.description')}</p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        {configured && (
          <div>
            <label htmlFor="lock-current-password" className="label mb-1.5 block">
              {t('lock.currentLabel')}
            </label>
            <input
              id="lock-current-password"
              type="password"
              className="input"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
          </div>
        )}

        <div>
          <label htmlFor="lock-new-password" className="label mb-1.5 block">
            {t('lock.newLabel')}
          </label>
          <input
            id="lock-new-password"
            type="password"
            className="input"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>

        {next.length > 0 && (
          <div>
            <label htmlFor="lock-confirm-password" className="label mb-1.5 block">
              {t('lock.confirmLabel')}
            </label>
            <input
              id="lock-confirm-password"
              type="password"
              className="input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
            {error}
          </div>
        )}
        {ok && (
          <div className="rounded-lg border border-sage-800/50 bg-sage-900/15 px-3 py-2 text-sm text-sage-200">
            {ok}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={mut.isPending}>
            {t(configured ? 'lock.change' : 'lock.set')}
          </button>
          {configured && (
            <button
              type="button"
              className="btn-ghost"
              disabled={mut.isPending || !current}
              onClick={remove}
            >
              {t('lock.remove')}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
