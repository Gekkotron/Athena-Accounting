import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api/client';
import { getTotpStatus } from '../../../api/totp';
import { TotpEnrollModal } from './TotpEnrollModal';
import { TotpDisableModal } from './TotpDisableModal';
import { TotpRegenerateModal } from './TotpRegenerateModal';

interface LockStatus {
  mode: 'session' | 'none';
  lockConfigured: boolean;
}

const IS_DEMO = import.meta.env.VITE_DEMO === '1';

// Optional TOTP card for the Settings › Security page. Wraps the enrol,
// disable and regenerate modals and reflects the current /status shape:
// disabled → activate CTA; enabled → remaining-codes label + disable and
// regenerate CTAs. Hidden on desktop (`AUTH_MODE=none`) and in demo mode.
export function TotpSection(): JSX.Element | null {
  const { t } = useTranslation('settings');
  const qc = useQueryClient();
  const [modal, setModal] = useState<'enroll' | 'disable' | 'regenerate' | null>(null);

  const lockQ = useQuery({
    queryKey: ['lock-status'],
    queryFn: () => api<LockStatus>('/api/auth/lock-status'),
    staleTime: Infinity,
  });
  const isSessionMode = lockQ.data?.mode === 'session';

  const statusQ = useQuery({
    queryKey: ['totp-status'],
    queryFn: getTotpStatus,
    enabled: isSessionMode && !IS_DEMO,
    staleTime: 30_000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['totp-status'] });

  if (IS_DEMO) return null;
  if (!lockQ.data) return null;
  if (!isSessionMode) return null;
  if (!statusQ.data) return null;

  const { enabled, remainingRecoveryCodes } = statusQ.data;
  const closeAndRefresh = () => { setModal(null); refresh(); };

  return (
    <section
      data-testid="totp-section"
      className="flex flex-col gap-4 pt-4 border-t border-ink-800/60"
    >
      <div>
        <div className="label">{t('settings.twoFactor.sectionTitle')}</div>
        <p className="text-sm text-ink-400 mt-1">
          {t('settings.twoFactor.description')}
        </p>
      </div>

      {!enabled && (
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-ink-300">
            {t('settings.twoFactor.disabledStatus')}
          </div>
          <button className="btn-primary" onClick={() => setModal('enroll')}>
            {t('settings.twoFactor.activateButton')}
          </button>
        </div>
      )}

      {enabled && (
        <>
          <div className="flex flex-col gap-1">
            <div className="text-sm text-sage-200">
              {t('settings.twoFactor.enabledStatus')}
            </div>
            <div className="text-sm text-ink-300">
              {t('settings.twoFactor.remainingCodes', { count: remainingRecoveryCodes })}
            </div>
            {remainingRecoveryCodes === 0 && (
              <div className="rounded-lg border border-amber-800/50 bg-amber-900/15 px-3 py-2 text-sm text-amber-200 mt-1">
                {t('settings.twoFactor.noRemainingCodesWarning')}
              </div>
            )}
          </div>
          <p className="text-xs text-ink-500">
            {t('settings.twoFactor.backupWarning')}
          </p>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => setModal('regenerate')}>
              {t('settings.twoFactor.regenerateButton')}
            </button>
            <button className="btn-danger" onClick={() => setModal('disable')}>
              {t('settings.twoFactor.disableButton')}
            </button>
          </div>
        </>
      )}

      <TotpEnrollModal
        open={modal === 'enroll'}
        onCancel={() => setModal(null)}
        onCompleted={closeAndRefresh}
      />
      <TotpDisableModal
        open={modal === 'disable'}
        onCancel={() => setModal(null)}
        onDisabled={closeAndRefresh}
      />
      <TotpRegenerateModal
        open={modal === 'regenerate'}
        onCancel={() => setModal(null)}
        onCompleted={closeAndRefresh}
      />
    </section>
  );
}
