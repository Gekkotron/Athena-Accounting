import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { termsOf, type LoanDetail, type LoanTermsInput } from '../../api/loans';
import { parseDecimal } from '../../lib/format';
import { FieldError, TextField } from './editor/Field';
import { splitAtDate } from './split-at-date';

interface Props {
  detail: LoanDetail;
  onCancel: () => void;
  onConfirm: (terms: LoanTermsInput) => void; // the page opens the editor pre-filled with these
}

export function ChangePaymentDialog({ detail, onCancel, onConfirm }: Props) {
  const { t } = useTranslation('loans');
  const [month, setMonth] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | undefined>();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = parseDecimal(amount);
    if (value === null || Number(value) <= 0) return setError('form.invalidDecimal');
    const terms = splitAtDate(termsOf(detail.loan), detail.schedule, month, { kind: 'amount', amount: value });
    if (!terms) return setError('changePayment.outside');
    onConfirm(terms);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={t('changePayment.title')}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onCancel}>
      <form noValidate onSubmit={submit} onClick={(e) => e.stopPropagation()} className="surface p-4 w-full max-w-md space-y-3">
        <h2 className="display text-sm text-ink-100">{t('changePayment.title')}</h2>
        <TextField id="change-from" type="month" label={t('changePayment.from')} value={month} onChange={setMonth} />
        <TextField id="change-amount" inputMode="decimal" label={t('changePayment.amount')} value={amount} onChange={setAmount} />
        <p className="text-[11px] text-ink-500">{t('changePayment.hint')}</p>
        <FieldError k={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>{t('actions.cancel')}</button>
          <button type="submit" className="btn-primary">{t('changePayment.continue')}</button>
        </div>
      </form>
    </div>
  );
}
