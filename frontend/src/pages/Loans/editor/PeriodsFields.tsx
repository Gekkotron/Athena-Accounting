import { useTranslation } from 'react-i18next';
import type { LoanFixedPeriodKind } from '../../../api/loans';
import { FieldError, SelectField, TextField } from './Field';
import type { FieldErrors, PeriodForm } from './form-state';

const KINDS: LoanFixedPeriodKind[] = ['payment', 'partial_deferral', 'total_deferral'];
const NEW_PERIOD: PeriodForm = { kind: 'payment', months: '12', amount: '', rate: '' };

interface Props {
  periods: PeriodForm[];
  onChange: (periods: PeriodForm[]) => void;
  errors: FieldErrors;
}

export function PeriodsFields({ periods, onChange, errors }: Props) {
  const { t } = useTranslation('loans');
  const update = (i: number, patch: Partial<PeriodForm>) =>
    onChange(periods.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const moveUp = (i: number) => {
    const next = periods.slice();
    [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
    onChange(next);
  };
  return (
    <fieldset className="space-y-2">
      <legend className="display text-xs text-ink-300 mb-2">{t('form.periods')}</legend>
      {periods.map((p, i) => (
        <div key={i} className="surface-soft p-2 grid gap-2 md:grid-cols-[1fr_6rem_1fr_8rem_auto] items-start">
          <SelectField id={`period-${i}-kind`} label={t('form.periodKind')} value={p.kind}
            options={KINDS.map((k) => ({ value: k, label: t(`timeline.kinds.${k}`) }))}
            onChange={(kind) => update(i, { kind })} />
          <TextField id={`period-${i}-months`} label={t('form.months')} inputMode="numeric" value={p.months}
            onChange={(months) => update(i, { months })} error={errors[`periods.${i}.months`]} />
          {p.kind === 'payment' ? (
            <TextField id={`period-${i}-amount`} label={t('form.amount')} inputMode="decimal" value={p.amount}
              onChange={(amount) => update(i, { amount })} error={errors[`periods.${i}.amount`]} />
          ) : <div />}
          <TextField id={`period-${i}-rate`} label={t('form.rate')} inputMode="decimal" value={p.rate}
            placeholder={t('form.ratePlaceholder')} onChange={(rate) => update(i, { rate })}
            error={errors[`periods.${i}.rate`]} />
          <div className="flex gap-1 md:pt-5">
            {i > 0 && (
              <button type="button" className="btn-secondary" aria-label={`${t('actions.moveUp')} ${i + 1}`}
                onClick={() => moveUp(i)}>↑</button>
            )}
            <button type="button" className="btn-secondary" onClick={() => onChange(periods.filter((_, j) => j !== i))}>
              {t('actions.remove')}
            </button>
          </div>
          <div className="md:col-span-5"><FieldError k={errors[`periods.${i}`]} /></div>
        </div>
      ))}
      <button type="button" className="btn-secondary" onClick={() => onChange([...periods, NEW_PERIOD])}>
        {t('form.addPeriod')}
      </button>
    </fieldset>
  );
}
