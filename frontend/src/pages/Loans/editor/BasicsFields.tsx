import { useTranslation } from 'react-i18next';
import type { LoanInsuranceBasis, LoanKind } from '../../../api/loans';
import { SelectField, TextField } from './Field';
import type { FieldErrors, LoanForm } from './form-state';

const KINDS: LoanKind[] = ['mortgage', 'consumer', 'auto', 'other'];
const BASES: LoanInsuranceBasis[] = ['initial', 'remaining'];

interface Props {
  form: LoanForm;
  onChange: (patch: Partial<LoanForm>) => void;
  errors: FieldErrors;
}

export function BasicsFields({ form, onChange, errors }: Props) {
  const { t } = useTranslation('loans');
  return (
    <fieldset className="grid gap-3 md:grid-cols-2">
      <legend className="display text-xs text-ink-300 mb-2">{t('form.basics')}</legend>
      <TextField id="loan-name" label={t('form.name')} value={form.name}
        onChange={(name) => onChange({ name })} error={errors.name} />
      <SelectField id="loan-kind" label={t('form.kind')} value={form.kind}
        options={KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) }))} onChange={(kind) => onChange({ kind })} />
      <TextField id="loan-principal" label={t('form.principal')} inputMode="decimal" value={form.principal}
        onChange={(principal) => onChange({ principal })} error={errors.principal} />
      <TextField id="loan-start" type="date" label={t('form.startDate')} value={form.startDate}
        onChange={(startDate) => onChange({ startDate })} error={errors.startDate} />
      <TextField id="loan-rate" label={t('form.annualRate')} inputMode="decimal" value={form.annualRate}
        onChange={(annualRate) => onChange({ annualRate })} error={errors.annualRate} />
      <TextField id="loan-fees" label={t('form.fees')} inputMode="decimal" value={form.fees}
        onChange={(fees) => onChange({ fees })} error={errors.fees} />
      <TextField id="loan-insurance-rate" label={t('form.insuranceRate')} inputMode="decimal" value={form.insuranceRate}
        onChange={(insuranceRate) => onChange({ insuranceRate })} error={errors.insuranceRate} />
      <SelectField id="loan-insurance-basis" label={t('form.insuranceBasis')} value={form.insuranceBasis}
        options={BASES.map((b) => ({ value: b, label: t(`form.basis.${b}`) }))}
        onChange={(insuranceBasis) => onChange({ insuranceBasis })} />
    </fieldset>
  );
}
