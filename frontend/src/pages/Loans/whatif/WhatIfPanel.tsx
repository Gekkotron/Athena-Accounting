import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { updateLoan, type LoanDetail, type LoanInput, type LoanRepaymentEffect } from '../../../api/loans';
import { parseDecimal } from '../../../lib/format';
import { FieldError, SelectField, TextField } from '../editor/Field';
import { PeriodsFields } from '../editor/PeriodsFields';
import { FinalPeriodFields } from '../editor/FinalPeriodFields';
import { EarlyRepaymentsFields } from '../editor/EarlyRepaymentsFields';
import { PreviewSummary } from '../editor/PreviewSummary';
import { useLoanPreview } from '../editor/useLoanPreview';
import {
  asSimulation, formFromLoan, formToInput, formToTerms, issuesToFieldErrors, parseRate, type LoanForm,
} from '../editor/form-state';
import { splitAtDate, type PaymentChange } from '../split-at-date';
import { ComparisonTable } from './ComparisonTable';

type Lever = 'early' | 'payment' | 'rate';
const LEVERS: Array<[Lever, string]> = [['early', 'whatIf.early'], ['payment', 'whatIf.newPayment'], ['rate', 'whatIf.newRate']];
const EFFECTS: LoanRepaymentEffect[] = ['shorten', 'reduce_payment'];
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

interface Props {
  detail: LoanDetail;
  onClose: () => void;
  onSaveAsSimulation: (form: LoanForm) => void;
}

export function WhatIfPanel({ detail, onClose, onSaveAsSimulation }: Props) {
  const { t } = useTranslation('loans');
  const qc = useQueryClient();
  const [form, setForm] = useState<LoanForm>(() => formFromLoan(detail.loan));
  const [lever, setLever] = useState<Lever>('early');
  const [month, setMonth] = useState('');
  const [value, setValue] = useState('');
  const [effect, setEffect] = useState<LoanRepaymentEffect>('shorten');
  const [leverError, setLeverError] = useState<string | undefined>();
  const parsed = useMemo(() => formToTerms(form), [form]);
  const preview = useLoanPreview('terms' in parsed ? parsed.terms : null);
  const errors = issuesToFieldErrors(preview.issues);
  const currency = detail.loan.currency;

  const apply = useMutation({
    mutationFn: (input: LoanInput) => updateLoan(detail.loan.id, input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['loans'] });
      onClose();
    },
  });

  const addLever = () => {
    setLeverError(undefined);
    if (!YEAR_MONTH.test(month)) return setLeverError('form.invalidMonth');
    if (lever === 'early') {
      const amount = parseDecimal(value);
      if (amount === null || Number(amount) <= 0) return setLeverError('form.invalidDecimal');
      setForm((f) => ({ ...f, earlyRepayments: [...f.earlyRepayments, { date: month, amount, effect, penalty: '' }] }));
      return;
    }
    let change: PaymentChange | null = null;
    if (lever === 'payment') {
      const amount = parseDecimal(value);
      if (amount !== null && Number(amount) > 0) change = { kind: 'amount', amount };
    } else {
      const rate = parseRate(value);
      if (rate !== null) change = { kind: 'rate', rate };
    }
    if (!change) return setLeverError(lever === 'payment' ? 'form.invalidDecimal' : 'form.invalidRate');
    // Split against the schedule of the CURRENT scenario (the preview), or
    // the saved loan's schedule before any lever was applied.
    const schedule = preview.data?.schedule ?? detail.schedule;
    const next = 'terms' in parsed ? splitAtDate(parsed.terms, schedule, month, change) : null;
    if (!next) return setLeverError('whatIf.outside');
    setForm((f) => formFromLoan({
      ...next, name: f.name, kind: f.kind, isSimulation: f.isSimulation, sourceLoanId: f.sourceLoanId, currency: f.currency,
    }));
  };

  const valueLabel = lever === 'early' ? t('form.earlyAmount') : lever === 'payment' ? t('changePayment.amount') : t('form.rate');
  const canApply = !apply.isPending && 'terms' in parsed && preview.issues.length === 0;

  return (
    <div role="dialog" aria-modal="true" aria-label={t('whatIf.title')}
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="surface p-4 w-full max-w-3xl space-y-4 my-8" onClick={(e) => e.stopPropagation()}>
        <h2 className="display text-sm text-ink-100">{t('whatIf.title')} — {detail.loan.name}</h2>
        {detail.summary && preview.data && (
          <ComparisonTable base={detail.summary} next={preview.data.summary} currency={currency}
            baseLabel={t('whatIf.current')} nextLabel={t('whatIf.scenario')} />
        )}

        <section className="surface-soft p-3 space-y-2">
          <h3 className="label">{t('whatIf.levers')}</h3>
          <div role="tablist" className="flex gap-1">
            {LEVERS.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={lever === k} onClick={() => setLever(k)}
                className={`px-2 py-1 text-xs rounded ${lever === k ? 'bg-ink-800 text-ink-100' : 'text-ink-500'}`}>
                {t(label)}
              </button>
            ))}
          </div>
          <div className="grid gap-2 md:grid-cols-4 items-end">
            <TextField id="lever-month" type="month" label={t('whatIf.fromMonth')} value={month} onChange={setMonth} />
            <TextField id="lever-value" inputMode="decimal" label={valueLabel} value={value} onChange={setValue} />
            {lever === 'early' && (
              <SelectField id="lever-effect" label={t('form.effectLabel')} value={effect}
                options={EFFECTS.map((k) => ({ value: k, label: t(`form.effect.${k}`) }))} onChange={setEffect} />
            )}
            <button type="button" className="btn-secondary" disabled={preview.pending} onClick={addLever}>
              {t('actions.add')}
            </button>
          </div>
          <FieldError k={leverError} />
        </section>

        <PreviewSummary preview={preview.data} pending={preview.pending} failed={preview.failed}
          issues={preview.issues} currency={currency} />

        <details>
          <summary className="cursor-pointer text-xs text-ink-300">{t('whatIf.fullEditor')}</summary>
          <div className="space-y-4 pt-3">
            <PeriodsFields periods={form.periods} onChange={(periods) => setForm((f) => ({ ...f, periods }))} errors={errors} />
            <FinalPeriodFields form={form} onChange={(p) => setForm((f) => ({ ...f, ...p }))} errors={errors}
              summary={preview.data?.summary} />
            <EarlyRepaymentsFields items={form.earlyRepayments}
              onChange={(earlyRepayments) => setForm((f) => ({ ...f, earlyRepayments }))} errors={errors} />
          </div>
        </details>

        {apply.isError && <div role="alert" className="text-xs text-clay-300">{t('form.genericError')}</div>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>{t('actions.discard')}</button>
          <button type="button" className="btn-secondary"
            onClick={() => onSaveAsSimulation(asSimulation(form, detail.loan, t('form.copyName', { name: detail.loan.name })))}>
            {t('actions.saveAsSimulation')}
          </button>
          <button type="button" className="btn-primary" disabled={!canApply}
            onClick={() => { const r = formToInput(form); if ('input' in r) apply.mutate(r.input); }}>
            {t('actions.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
