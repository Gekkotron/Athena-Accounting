import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { parseDecimal } from '../../lib/format';
import { todayLocalIso } from '../../lib/dates';
import { AccountFormFields } from './AccountFormFields';

export interface AccountFormValues {
  name: string;
  type: string;
  currency: string;
  openingBalance: string;
  openingDate: string;
  // Default lock period in years. null / '' input = no lock. Applies to the
  // opening balance and any transaction without its own override.
  lockYears: number | null;
  // Closing date. Non-null = account is displayed as closed. Only editable
  // in edit mode (a freshly-created account is not closed).
  closedAt: string | null;
  // Optional manual IBAN. Backend normalizes it (strips spaces, uppercases)
  // and refuses the update when the account is synced; the form passes
  // ibanLocked separately so the input can render read-only in edit mode.
  iban: string | null;
}

export function AccountForm({
  mode,
  initial,
  ibanLocked,
  onSubmit,
  onCancel,
  onDelete,
  submitting,
  error,
}: {
  mode: 'create' | 'edit';
  initial?: Partial<AccountFormValues>;
  // Edit mode only — when true, the IBAN input renders read-only because
  // the authoritative value lives on a mapped bank_connection_accounts row.
  ibanLocked?: boolean;
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
    initial?.openingDate ?? todayLocalIso()
  );
  const [lockYearsInput, setLockYearsInput] = useState(
    initial?.lockYears == null ? '' : String(initial.lockYears),
  );
  const [closedAt, setClosedAt] = useState<string>(initial?.closedAt ?? '');
  const [iban, setIban] = useState<string>(initial?.iban ?? '');

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
      closedAt: closedAt.trim() === '' ? null : closedAt,
      iban: iban.trim() === '' ? null : iban.replace(/\s+/g, '').toUpperCase(),
    };
  };

  const fields = (
    <AccountFormFields
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
      closedAt={closedAt}
      setClosedAt={setClosedAt}
      iban={iban}
      setIban={setIban}
      ibanLocked={ibanLocked === true}
      mode={mode}
    />
  );

  if (mode === 'create') {
    const submit = (e: FormEvent) => {
      e.preventDefault();
      const v = buildValues();
      if (v) onSubmit(v);
    };

    return (
      <form onSubmit={submit} className="surface p-5 md:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        {fields}
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
      <div className="grid grid-cols-2 gap-3">{fields}</div>
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
