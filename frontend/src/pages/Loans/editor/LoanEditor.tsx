import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { createLoan, loanIssues, updateLoan, type Loan, type LoanInput } from '../../../api/loans';
import { ApiError } from '../../../api/apiError';
import { BasicsFields } from './BasicsFields';
import { PeriodsFields } from './PeriodsFields';
import { FinalPeriodFields } from './FinalPeriodFields';
import { EarlyRepaymentsFields } from './EarlyRepaymentsFields';
import { PreviewSummary } from './PreviewSummary';
import { useLoanPreview } from './useLoanPreview';
import { formToInput, formToTerms, issuesToFieldErrors, type FieldErrors, type LoanForm } from './form-state';

interface Props {
  title: string;
  initial: LoanForm;
  loanId: number | null; // null = create
  onClose: () => void;
  onSaved: (loan: Loan) => void;
}

export function LoanEditor({ title, initial, loanId, onClose, onSaved }: Props) {
  const { t } = useTranslation('loans');
  const qc = useQueryClient();
  const [form, setForm] = useState<LoanForm>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const parsed = useMemo(() => formToTerms(form), [form]);
  const preview = useLoanPreview('terms' in parsed ? parsed.terms : null);

  // Parse errors appear after the first submit attempt; engine errors from
  // the live preview appear as soon as the server reports them.
  const local = submitted ? formToInput(form) : null;
  const errors: FieldErrors = {
    ...(local && 'fieldErrors' in local ? local.fieldErrors : {}),
    ...issuesToFieldErrors(preview.issues),
  };

  const save = useMutation({
    mutationFn: (input: LoanInput) => (loanId === null ? createLoan(input) : updateLoan(loanId, input)),
    onSuccess: async ({ loan }) => {
      await qc.invalidateQueries({ queryKey: ['loans'] });
      onSaved(loan);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) setServerError(t('form.nameTaken'));
      else if (loanIssues(err)) setServerError(t('form.fixErrors'));
      else setServerError(t('form.genericError'));
    },
  });

  const patch = (p: Partial<LoanForm>) => setForm((f) => ({ ...f, ...p }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setServerError(null);
    const res = formToInput(form);
    if ('input' in res) save.mutate(res.input);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <form noValidate onSubmit={submit} onClick={(e) => e.stopPropagation()} className="surface p-4 w-full max-w-3xl space-y-5 my-8">
        <h2 className="display text-sm text-ink-100">{title}</h2>
        <BasicsFields form={form} onChange={patch} errors={errors} />
        <PeriodsFields periods={form.periods} onChange={(periods) => patch({ periods })} errors={errors} />
        <FinalPeriodFields form={form} onChange={patch} errors={errors} summary={preview.data?.summary} />
        <EarlyRepaymentsFields items={form.earlyRepayments} onChange={(earlyRepayments) => patch({ earlyRepayments })} errors={errors} />
        <PreviewSummary preview={preview.data} pending={preview.pending} failed={preview.failed} issues={preview.issues} currency={form.currency} />
        {serverError && <div role="alert" className="text-xs text-clay-300">{serverError}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>{t('actions.cancel')}</button>
          <button type="submit" className="btn-primary" disabled={save.isPending}>{t('actions.save')}</button>
        </div>
      </form>
    </div>
  );
}
