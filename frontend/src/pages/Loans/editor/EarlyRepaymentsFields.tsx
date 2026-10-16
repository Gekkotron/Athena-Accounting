import { useTranslation } from 'react-i18next';
import type { LoanRepaymentEffect } from '../../../api/loans';
import { SelectField, TextField } from './Field';
import type { EarlyForm, FieldErrors } from './form-state';

const EFFECTS: LoanRepaymentEffect[] = ['shorten', 'reduce_payment'];
const NEW_EARLY: EarlyForm = { date: '', amount: '', effect: 'shorten', penalty: '' };

interface Props {
  items: EarlyForm[];
  onChange: (items: EarlyForm[]) => void;
  errors: FieldErrors;
}

export function EarlyRepaymentsFields({ items, onChange, errors }: Props) {
  const { t } = useTranslation('loans');
  const update = (i: number, patch: Partial<EarlyForm>) =>
    onChange(items.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  return (
    <fieldset className="space-y-2">
      <legend className="display text-xs text-ink-300 mb-2">{t('form.early')}</legend>
      {items.map((e, i) => (
        <div key={i} className="surface-soft p-2 grid gap-2 md:grid-cols-[9rem_1fr_1fr_8rem_auto] items-start">
          <TextField id={`early-${i}-date`} type="month" label={t('form.earlyDate')} value={e.date}
            onChange={(date) => update(i, { date })} error={errors[`earlyRepayments.${i}.date`]} />
          <TextField id={`early-${i}-amount`} label={t('form.earlyAmount')} inputMode="decimal" value={e.amount}
            onChange={(amount) => update(i, { amount })} error={errors[`earlyRepayments.${i}.amount`]} />
          <SelectField id={`early-${i}-effect`} label={t('form.effectLabel')} value={e.effect}
            options={EFFECTS.map((k) => ({ value: k, label: t(`form.effect.${k}`) }))}
            onChange={(effect) => update(i, { effect })} />
          <TextField id={`early-${i}-penalty`} label={t('form.penalty')} inputMode="decimal" value={e.penalty}
            onChange={(penalty) => update(i, { penalty })} error={errors[`earlyRepayments.${i}.penalty`]} />
          <div className="md:pt-5">
            <button type="button" className="btn-secondary" onClick={() => onChange(items.filter((_, j) => j !== i))}>
              {t('actions.remove')}
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="btn-secondary" onClick={() => onChange([...items, NEW_EARLY])}>
        {t('form.addEarly')}
      </button>
    </fieldset>
  );
}
