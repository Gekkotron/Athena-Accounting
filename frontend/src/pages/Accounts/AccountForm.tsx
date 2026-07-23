import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { parseDecimal } from '../../lib/format';

export interface AccountFormValues {
  name: string;
  type: string;
  currency: string;
  openingBalance: string;
  openingDate: string;
  // Default lock period in years. null / '' input = no lock. Applies to the
  // opening balance and any transaction without its own override.
  lockYears: number | null;
}

function FormFields({
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
}) {
  const { t } = useTranslation('accounts');
  return (
    <>
      <div className={mode === 'create' ? 'lg:col-span-2' : ''}>
        <label className="label mb-1.5 block">{t('form.labels.name')}</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required={mode === 'create'} />
      </div>
      <div className={mode === 'create' ? '' : ''}>
        <label className="label mb-1.5 block">{t('form.labels.type')}</label>
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="checking">{t('form.typeOptions.checking')}</option>
          <option value="savings">{t('form.typeOptions.savings')}</option>
          <option value="investment">{t('form.typeOptions.investment')}</option>
          <option value="credit">{t('form.typeOptions.credit')}</option>
          <option value="other">{t('form.typeOptions.other')}</option>
        </select>
      </div>
      <div>
        <label className="label mb-1.5 block">{t('form.labels.currency')}</label>
        <input
          className="input"
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          maxLength={3}
          required={mode === 'create'}
        />
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

export function AccountForm({
  mode,
  initial,
  onSubmit,
  onCancel,
  onDelete,
  submitting,
  error,
}: {
  mode: 'create' | 'edit';
  initial?: Partial<AccountFormValues>;
  onSubmit: (values: AccountFormValues) => void;
  onCancel?: () => void;
  onDelete?: () => void;
  submitting?: boolean;
  error?: string | null;
}) {
  const { t } = useTranslation(['accounts', 'common']);
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState(initial?.type ?? 'checking');
  const [currency, setCurrency] = useState(initial?.currency ?? 'EUR');
  const [openingBalance, setOpeningBalance] = useState(initial?.openingBalance ?? '0.00');
  const [openingDate, setOpeningDate] = useState(
    initial?.openingDate ?? new Date().toISOString().slice(0, 10)
  );
  const [lockYearsInput, setLockYearsInput] = useState(
    initial?.lockYears == null ? '' : String(initial.lockYears),
  );

  const parsedLockYears = ((): number | null => {
    const raw = lockYearsInput.trim();
    if (raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 99 ? Math.floor(n) : null;
  })();

  // Normalize the openingBalance so French comma inputs ("1500,00") don't
  // get 400ed by the backend zod regex.
  const parsedOpeningBalance = parseDecimal(openingBalance);
  const [openingBalanceError, setOpeningBalanceError] = useState<string | null>(null);

  const buildValues = (): AccountFormValues | null => {
    if (parsedOpeningBalance == null) {
      setOpeningBalanceError(t('form.errors.invalidOpeningBalance'));
      return null;
    }
    setOpeningBalanceError(null);
    return {
      name, type, currency,
      openingBalance: parsedOpeningBalance,
      openingDate,
      lockYears: parsedLockYears,
    };
  };

  if (mode === 'create') {
    const submit = (e: FormEvent) => {
      e.preventDefault();
      const v = buildValues();
      if (v) onSubmit(v);
    };

    return (
      <form onSubmit={submit} className="surface p-5 md:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        <FormFields
          name={name}
          setName={setName}
          type={type}
          setType={setType}
          currency={currency}
          setCurrency={setCurrency}
          openingBalance={openingBalance}
          setOpeningBalance={setOpeningBalance}
          openingDate={openingDate}
          setOpeningDate={setOpeningDate}
          lockYearsInput={lockYearsInput}
          setLockYearsInput={setLockYearsInput}
          mode="create"
        />
        {(error || openingBalanceError) && (
          <div className="sm:col-span-2 lg:col-span-6 rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
            {openingBalanceError ?? error}
          </div>
        )}
        <div className="sm:col-span-2 lg:col-span-6">
          <button className="btn-primary" disabled={submitting}>
            {submitting ? t('form.creating') : t('form.createSubmit')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <FormFields
          name={name}
          setName={setName}
          type={type}
          setType={setType}
          currency={currency}
          setCurrency={setCurrency}
          openingBalance={openingBalance}
          setOpeningBalance={setOpeningBalance}
          openingDate={openingDate}
          setOpeningDate={setOpeningDate}
          lockYearsInput={lockYearsInput}
          setLockYearsInput={setLockYearsInput}
          mode="edit"
        />
      </div>
      {(error || openingBalanceError) && (
        <div className="rounded-md border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-xs text-clay-200">
          {openingBalanceError ?? error}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 pt-1">
        {onDelete ? (
          <button className="text-[11px] text-clay-300 hover:text-clay-200 transition" onClick={onDelete}>
            {t('form.deleteButton')}
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={onCancel}>
            {t('cancel', { ns: 'common' })}
          </button>
          <button className="btn-primary" onClick={() => { const v = buildValues(); if (v) onSubmit(v); }} disabled={submitting}>
            {submitting ? t('form.saving') : t('save', { ns: 'common' })}
          </button>
        </div>
      </div>
    </div>
  );
}
