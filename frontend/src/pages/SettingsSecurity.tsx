import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';

interface SecurityStatus {
  driver: 'pglite' | 'postgres';
  encrypted: boolean;
  pendingDisable: boolean;
}

// Shared by all three mutations below: the backend maps a wrong passphrase
// to 403 (see backend/src/http/routes/security.ts verifyPassword()) and
// anything else (validation, snapshot pipeline failure) to a generic error.
function describeError(err: unknown, t: (key: string) => string): string {
  if (err instanceof ApiError && err.status === 403) return t('settings.security.wrongPassword');
  return t('settings.security.genericError');
}

export function SettingsSecurity(): JSX.Element | null {
  const { t } = useTranslation('settings');
  const qc = useQueryClient();
  const statusQ = useQuery({
    queryKey: ['security-status'],
    queryFn: () => api<SecurityStatus>('/api/security'),
  });

  const refreshStatus = () => qc.invalidateQueries({ queryKey: ['security-status'] });

  const [enablePassword, setEnablePassword] = useState('');
  const [enableConfirm, setEnableConfirm] = useState('');
  const [enableError, setEnableError] = useState<string | null>(null);
  const [enableOk, setEnableOk] = useState(false);
  const enableMut = useMutation({
    mutationFn: (password: string) => api('/api/security/enable', { method: 'POST', json: { password } }),
    onSuccess: () => {
      setEnablePassword('');
      setEnableConfirm('');
      setEnableError(null);
      setEnableOk(true);
      refreshStatus();
    },
    onError: (err) => {
      setEnableOk(false);
      setEnableError(describeError(err, t));
    },
  });

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newConfirm, setNewConfirm] = useState('');
  const [changeError, setChangeError] = useState<string | null>(null);
  const [changeOk, setChangeOk] = useState(false);
  const changeMut = useMutation({
    mutationFn: (input: { oldPassword: string; newPassword: string }) =>
      api('/api/security/change', { method: 'POST', json: input }),
    onSuccess: () => {
      setOldPassword('');
      setNewPassword('');
      setNewConfirm('');
      setChangeError(null);
      setChangeOk(true);
    },
    onError: (err) => {
      setChangeOk(false);
      setChangeError(describeError(err, t));
    },
  });

  const [disablePassword, setDisablePassword] = useState('');
  const [disableError, setDisableError] = useState<string | null>(null);
  const disableMut = useMutation({
    mutationFn: (password: string) => api('/api/security/disable', { method: 'POST', json: { password } }),
    onSuccess: () => {
      setDisablePassword('');
      setDisableError(null);
      refreshStatus();
    },
    onError: (err) => setDisableError(describeError(err, t)),
  });

  if (!statusQ.data) return null;
  const { driver, encrypted, pendingDisable } = statusQ.data;

  const enableValid = enablePassword.length >= 8 && enablePassword === enableConfirm;
  const changeValid =
    oldPassword.length >= 8 && newPassword.length >= 8 && newPassword === newConfirm;
  const disableValid = disablePassword.length >= 8;

  function submitEnable(e: FormEvent) {
    e.preventDefault();
    if (!enableValid) return;
    enableMut.mutate(enablePassword);
  }
  function submitChange(e: FormEvent) {
    e.preventDefault();
    if (!changeValid) return;
    changeMut.mutate({ oldPassword, newPassword });
  }
  function submitDisable(e: FormEvent) {
    e.preventDefault();
    if (!disableValid) return;
    disableMut.mutate(disablePassword);
  }

  return (
    <section className="flex flex-col gap-4 pt-4 border-t border-ink-800/60">
      <div className="label">{t('settings.security.sectionTitle')}</div>

      {driver === 'postgres' && (
        <p className="text-sm text-ink-400">{t('settings.security.postgresPointer')}</p>
      )}

      {driver === 'pglite' && pendingDisable && (
        <div className="rounded-lg border border-amber-800/50 bg-amber-900/15 px-3 py-2 text-sm text-amber-200">
          {t('settings.security.disablePending')}
        </div>
      )}

      {driver === 'pglite' && !encrypted && !pendingDisable && (
        <form onSubmit={submitEnable} className="flex flex-col gap-3">
          <div className="label">{t('settings.security.enable.title')}</div>
          <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
            {t('settings.security.noRecoveryWarning')}
          </div>
          <div>
            <label htmlFor="security-enable-password" className="label mb-1.5 block">
              {t('settings.security.enable.password')}
            </label>
            <input
              id="security-enable-password"
              type="password"
              className="input"
              value={enablePassword}
              onChange={(e) => setEnablePassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
            />
          </div>
          <div>
            <label htmlFor="security-enable-confirm" className="label mb-1.5 block">
              {t('settings.security.enable.confirm')}
            </label>
            <input
              id="security-enable-confirm"
              type="password"
              className="input"
              value={enableConfirm}
              onChange={(e) => setEnableConfirm(e.target.value)}
              autoComplete="new-password"
              minLength={8}
            />
          </div>
          {enableError && (
            <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
              {enableError}
            </div>
          )}
          {enableOk && (
            <div className="rounded-lg border border-sage-800/50 bg-sage-900/15 px-3 py-2 text-sm text-sage-200">
              {t('settings.security.enable.success')}
            </div>
          )}
          <button className="btn-primary" disabled={!enableValid || enableMut.isPending}>
            {t('settings.security.enable.submit')}
          </button>
        </form>
      )}

      {driver === 'pglite' && encrypted && (
        <>
          <form onSubmit={submitChange} className="flex flex-col gap-3">
            <div className="label">{t('settings.security.change.title')}</div>
            <div>
              <label htmlFor="security-change-old" className="label mb-1.5 block">
                {t('settings.security.change.old')}
              </label>
              <input
                id="security-change-old"
                type="password"
                className="input"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div>
              <label htmlFor="security-change-new" className="label mb-1.5 block">
                {t('settings.security.change.new')}
              </label>
              <input
                id="security-change-new"
                type="password"
                className="input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
              />
            </div>
            <div>
              <label htmlFor="security-change-confirm" className="label mb-1.5 block">
                {t('settings.security.change.confirm')}
              </label>
              <input
                id="security-change-confirm"
                type="password"
                className="input"
                value={newConfirm}
                onChange={(e) => setNewConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={8}
              />
            </div>
            {changeError && (
              <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
                {changeError}
              </div>
            )}
            {changeOk && (
              <div className="rounded-lg border border-sage-800/50 bg-sage-900/15 px-3 py-2 text-sm text-sage-200">
                {t('settings.security.change.success')}
              </div>
            )}
            <button className="btn-primary" disabled={!changeValid || changeMut.isPending}>
              {t('settings.security.change.submit')}
            </button>
          </form>

          <form onSubmit={submitDisable} className="flex flex-col gap-3 pt-4 border-t border-ink-800/60">
            <div className="label">{t('settings.security.disable.title')}</div>
            <div>
              <label htmlFor="security-disable-password" className="label mb-1.5 block">
                {t('settings.security.disable.password')}
              </label>
              <input
                id="security-disable-password"
                type="password"
                className="input"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <p className="text-xs text-ink-400">{t('settings.security.disable.note')}</p>
            {disableError && (
              <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
                {disableError}
              </div>
            )}
            <button className="btn-danger" disabled={!disableValid || disableMut.isPending}>
              {t('settings.security.disable.submit')}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
