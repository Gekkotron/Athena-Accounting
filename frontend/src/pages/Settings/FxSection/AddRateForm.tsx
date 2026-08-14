import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { parseDecimal } from '../../../lib/format';

export interface AddRateFormValues {
  from: string;
  to: string;
  effectiveFrom: string;
  rate: string;
}

interface AddRateFormProps {
  currencies: string[];
  onSubmit: (values: AddRateFormValues) => void;
  // 'duplicate' surfaces the 409 the backend/demo layer returns for an
  // existing (from, to, effectiveFrom) row; anything else falls back to a
  // generic message.
  error?: string | null;
  initialFrom?: string;
  initialTo?: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AddRateForm({
  currencies,
  onSubmit,
  error,
  initialFrom,
  initialTo,
}: AddRateFormProps): JSX.Element {
  const { t } = useTranslation('settings');
  const [from, setFrom] = useState(initialFrom ?? currencies[0] ?? '');
  const [to, setTo] = useState(initialTo ?? currencies[1] ?? currencies[0] ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [rate, setRate] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (from === to) {
      setLocalError(t('settings.fx.rates.sameCurrency'));
      return;
    }
    const parsed = parseDecimal(rate);
    if (parsed === null) {
      setLocalError(t('settings.fx.rates.invalidRate'));
      return;
    }
    setLocalError(null);
    onSubmit({ from, to, effectiveFrom, rate: parsed });
    setRate('');
  }

  const displayError = error === 'duplicate' ? t('settings.fx.rates.duplicate') : localError;

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="fx-add-from" className="label mb-1.5 block">
          {t('settings.fx.rates.columns.from')}
        </label>
        <select
          id="fx-add-from"
          className="input"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        >
          {currencies.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="fx-add-to" className="label mb-1.5 block">
          {t('settings.fx.rates.columns.to')}
        </label>
        <select
          id="fx-add-to"
          className="input"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        >
          {currencies.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="fx-add-effective" className="label mb-1.5 block">
          {t('settings.fx.rates.columns.effectiveFrom')}
        </label>
        <input
          id="fx-add-effective"
          type="date"
          className="input"
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
        />
      </div>

      <div>
        <label htmlFor="fx-add-rate" className="label mb-1.5 block">
          {t('settings.fx.rates.columns.rate')}
        </label>
        <input
          id="fx-add-rate"
          type="text"
          inputMode="decimal"
          className="input"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
      </div>

      <button type="submit" className="btn-primary">
        {t('settings.fx.rates.add')}
      </button>

      {displayError && (
        <div className="w-full rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
          {displayError}
        </div>
      )}
    </form>
  );
}
