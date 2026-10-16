import { useTranslation } from 'react-i18next';
import type { LoanSummary } from '../../../api/loans';
import { formatAmount, formatMonth } from '../../../lib/format';
import { FieldError, TextField } from './Field';
import type { FieldErrors, LoanForm } from './form-state';

const MODES = ['payment', 'end_date'] as const;

interface Props {
  form: LoanForm;
  onChange: (patch: Partial<LoanForm>) => void;
  errors: FieldErrors;
  summary: LoanSummary | undefined; // live preview — shows the solved value
}

export function FinalPeriodFields({ form, onChange, errors, summary }: Props) {
  const { t } = useTranslation('loans');
  let solved: string | null = null;
  if (summary && form.solve === 'payment' && summary.solvedPayment) {
    solved = t('form.solvedPayment', { amount: formatAmount(summary.solvedPayment, form.currency) });
  } else if (summary && form.solve === 'end_date') {
    solved = t('form.solvedEnd', { date: formatMonth(summary.endDate) });
  }
  return (
    <fieldset className="space-y-2">
      <legend className="display text-xs text-ink-300 mb-2">{t('form.finalTitle')}</legend>
      <div role="radiogroup" aria-label={t('form.finalTitle')} className="flex flex-col gap-1 text-xs">
        {MODES.map((m) => (
          <label key={m} className="flex items-center gap-2">
            <input type="radio" name="loan-solve" value={m} checked={form.solve === m} onChange={() => onChange({ solve: m })} />
            {t(`form.solve.${m}`)}
          </label>
        ))}
      </div>
      <div className="grid gap-2 md:grid-cols-3 items-start">
        {form.solve === 'payment' ? (
          <TextField id="final-end" type="month" label={t('form.endDate')} value={form.endDate}
            onChange={(endDate) => onChange({ endDate })} error={errors['finalPeriod.endDate']} />
        ) : (
          <TextField id="final-amount" label={t('form.finalAmount')} inputMode="decimal" value={form.finalAmount}
            onChange={(finalAmount) => onChange({ finalAmount })} error={errors['finalPeriod.amount']} />
        )}
        <TextField id="final-rate" label={t('form.rate')} inputMode="decimal" value={form.finalRate}
          placeholder={t('form.ratePlaceholder')} onChange={(finalRate) => onChange({ finalRate })}
          error={errors['finalPeriod.rate']} />
        {solved && (
          <output aria-live="polite" className="md:pt-6 text-sm text-sage-300 font-mono private">{solved}</output>
        )}
      </div>
      <FieldError k={errors.finalPeriod} />
    </fieldset>
  );
}
