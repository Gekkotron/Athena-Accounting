import { useEffect, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { confirmTotp, enrollTotp, type TotpEnrollResponse } from '../../../api/totp';
import { describeTotpError } from './totp-errors';
import { RecoveryCodesView } from './RecoveryCodesView';

interface Props {
  open: boolean;
  onCancel: () => void;
  onCompleted: () => void;
}

type Step = 'password' | 'code' | 'codes';

export function TotpEnrollModal({ open, onCancel, onCompleted }: Props) {
  const { t } = useTranslation('settings');
  const [step, setStep] = useState<Step>('password');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<TotpEnrollResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('password');
    setPassword('');
    setPending(null);
    setQrDataUrl(null);
    setCode('');
    setRecoveryCodes([]);
    setPasswordError(null);
    setCodeError(null);
  }, [open]);

  const enrollMut = useMutation({
    mutationFn: (pw: string) => enrollTotp(pw),
    onSuccess: async (data) => {
      setPending(data);
      setStep('code');
      // Dynamic import — the qrcode dep only reaches the bundle when the
      // enrol modal actually opens. Route-level chunking keeps it out of
      // the login and dashboard paths.
      try {
        const mod = await import('qrcode');
        const toDataURL = (mod.default?.toDataURL ?? mod.toDataURL) as (u: string, o?: unknown) => Promise<string>;
        const url = await toDataURL(data.otpauthUrl, { errorCorrectionLevel: 'M', margin: 1, scale: 6 });
        setQrDataUrl(url);
      } catch {
        setQrDataUrl(null);
      }
    },
    onError: (err) => setPasswordError(describeTotpError(err, t, 'password')),
  });

  const confirmMut = useMutation({
    mutationFn: (c: string) => confirmTotp(c),
    onSuccess: (data) => {
      setRecoveryCodes(data.recoveryCodes);
      setStep('codes');
    },
    onError: (err) => setCodeError(describeTotpError(err, t, 'code')),
  });

  if (!open) return null;

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    if (password.length < 1) return;
    enrollMut.mutate(password);
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    setCodeError(null);
    if (!/^\d{6}$/.test(code)) return;
    confirmMut.mutate(code);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-ink-950/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('settings.twoFactor.sectionTitle')}
      onClick={onCancel}
    >
      <div className="surface w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        {step === 'password' && (
          <form onSubmit={submitPassword} className="flex flex-col gap-4">
            <div>
              <div className="display text-xl text-ink-50 mb-1 leading-snug">
                {t('settings.twoFactor.enroll.step1Title')}
              </div>
              <p className="text-sm text-ink-400">
                {t('settings.twoFactor.enroll.step1Description')}
              </p>
            </div>
            <div>
              <label htmlFor="totp-enroll-password" className="label mb-1.5 block">
                {t('settings.twoFactor.enroll.passwordLabel')}
              </label>
              <input
                id="totp-enroll-password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
                required
              />
            </div>
            {passwordError && (
              <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
                {passwordError}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={onCancel}>
                {t('settings.security.disable.password' as string)
                  ? t('cancel' as string, { defaultValue: 'Annuler' })
                  : 'Annuler'}
              </button>
              <button className="btn-primary" disabled={enrollMut.isPending || password.length < 1}>
                {t('settings.twoFactor.enroll.continueButton')}
              </button>
            </div>
          </form>
        )}

        {step === 'code' && pending && (
          <form onSubmit={submitCode} className="flex flex-col gap-4">
            <div>
              <div className="display text-xl text-ink-50 mb-1 leading-snug">
                {t('settings.twoFactor.enroll.step2Title')}
              </div>
              <p className="text-sm text-ink-400">
                {t('settings.twoFactor.enroll.step2Description')}
              </p>
            </div>
            <div className="flex justify-center">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="QR"
                  width={200}
                  height={200}
                  className="rounded-md bg-white p-2"
                />
              ) : (
                <div className="text-sm text-ink-400 py-16">
                  {t('settings.twoFactor.enroll.qrLoading')}
                </div>
              )}
            </div>
            <div>
              <div className="label mb-1">{t('settings.twoFactor.enroll.manualKeyLabel')}</div>
              <code className="block text-ink-100 font-mono text-sm tracking-widest bg-ink-900 rounded-md p-2 break-all">
                {pending.secret}
              </code>
            </div>
            <div>
              <label htmlFor="totp-enroll-code" className="label mb-1.5 block">
                {t('settings.twoFactor.enroll.codeLabel')}
              </label>
              <input
                id="totp-enroll-code"
                type="text"
                className="input"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
              />
            </div>
            {codeError && (
              <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
                {codeError}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={onCancel}>
                {t('cancel' as string, { defaultValue: 'Annuler', ns: 'common' })}
              </button>
              <button className="btn-primary" disabled={confirmMut.isPending || !/^\d{6}$/.test(code)}>
                {t('settings.twoFactor.enroll.verifyButton')}
              </button>
            </div>
          </form>
        )}

        {step === 'codes' && (
          <div className="flex flex-col gap-4">
            <div className="display text-xl text-ink-50 leading-snug">
              {t('settings.twoFactor.enroll.step3Title')}
            </div>
            <RecoveryCodesView codes={recoveryCodes} onDone={onCompleted} />
          </div>
        )}
      </div>
    </div>
  );
}
