import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { InfoTip } from '../../components/InfoTip';

const ACCOUNT_TYPES = ['checking', 'savings', 'investment', 'credit', 'other'] as const;

// Full ISO 4217 list from the JS engine (~170 codes). Fallback to the common
// set if the runtime pre-dates Intl.supportedValuesOf.
const ISO_CURRENCY_CODES: string[] = (() => {
  try {
    return Intl.supportedValuesOf('currency');
  } catch {
    return ['EUR', 'USD', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'CNY'];
  }
})();

export function AccountFormFields({
  name,
  setName,
  type,
  setType,
  currency,
  setCurrency,
  openingBalance,
  setOpeningBalance,
  openingDate,
  setOpeningDate,
  lockYearsInput,
  setLockYearsInput,
  mode,
}: {
  name: string;
  setName: (v: string) => void;
  type: string;
  setType: (v: string) => void;
  currency: string;
  setCurrency: (v: string) => void;
  openingBalance: string;
  setOpeningBalance: (v: string) => void;
  openingDate: string;
  setOpeningDate: (v: string) => void;
  lockYearsInput: string;
  setLockYearsInput: (v: string) => void;
  mode: 'create' | 'edit';
}): JSX.Element {
  const { t, i18n } = useTranslation('accounts');
  const currencyOptions = useMemo(() => {
    const locale = i18n.language?.startsWith('en') ? 'en' : 'fr';
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([locale], { type: 'currency' });
    } catch {
      names = null;
    }
    return ISO_CURRENCY_CODES
      .map((code) => {
        const name = names?.of(code);
        return { code, label: name && name !== code ? `${code} — ${name}` : code };
      })
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [i18n.language]);
  return (
    <>
      <div className={mode === 'create' ? 'lg:col-span-2' : ''}>
        <label className="label mb-1.5 block">{t('form.labels.name')}</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required={mode === 'create'} />
      </div>
      <div>
        {/* The label stays the direct child queried by tests' fieldFor helper;
            the flex row only hosts the InfoTip beside it. */}
        <div className="mb-1.5 flex items-center gap-1.5">
          <label className="label">{t('form.labels.type')}</label>
          <InfoTip text={t('form.typeHelp.aria')}>
            <ul className="space-y-0.5">
              {ACCOUNT_TYPES.map((k) => (
                <li key={k}>
                  <span className="font-medium">{t(`form.typeOptions.${k}`)}</span>
                  {' — '}
                  {t(`form.typeHelp.${k}`)}
                </li>
              ))}
            </ul>
            <div className="mt-1.5 pt-1.5 border-t border-ink-700 text-ink-300">
              {t('form.typeHelp.note')}
            </div>
          </InfoTip>
        </div>
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          {ACCOUNT_TYPES.map((k) => (
            <option key={k} value={k}>{t(`form.typeOptions.${k}`)}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label mb-1.5 block">{t('form.labels.currency')}</label>
        <select
          className="input"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          required={mode === 'create'}
        >
          {currencyOptions.map((c) => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label mb-1.5 block">{t('form.labels.openingBalance')}</label>
        <input
          className="input font-mono"
          value={openingBalance}
          onChange={(e) => setOpeningBalance(e.target.value)}
          required={mode === 'create'}
        />
        {mode === 'edit' && (
          <div className="text-[11px] text-ink-500 mt-1">
            {t('form.openingBalanceEditHint')}
          </div>
        )}
      </div>
      <div>
        <label className="label mb-1.5 block">{t('form.labels.openingDate')}</label>
        <input
          type="date"
          className="input"
          value={openingDate}
          onChange={(e) => setOpeningDate(e.target.value)}
          required={mode === 'create'}
        />
      </div>
      <div>
        <label className="label mb-1.5 block" title={t('form.lockYearsTitle')}>
          {t('form.labels.lockYears')}
        </label>
        <input
          inputMode="numeric"
          className="input font-mono"
          value={lockYearsInput}
          placeholder="—"
          onChange={(e) => setLockYearsInput(e.target.value)}
        />
      </div>
    </>
  );
}
