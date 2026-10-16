import { useTranslation } from 'react-i18next';
import type { LoanIssue, LoanSimulation } from '../../../api/loans';
import { formatAmount, formatMonth } from '../../../lib/format';

interface Props {
  preview: LoanSimulation | undefined;
  pending: boolean;
  failed: boolean;
  issues: LoanIssue[];
  currency: string;
}

export function PreviewSummary({ preview, pending, failed, issues, currency }: Props) {
  const { t } = useTranslation('loans');
  const s = preview?.summary;
  const fmt = (v: string) => formatAmount(v, currency);
  const notes = [...issues, ...(preview?.warnings ?? [])];
  return (
    <section aria-live="polite" className="surface-soft p-3 text-xs space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="label">{t('form.previewTitle')}</span>
        {pending && <span className="text-ink-500">{t('form.previewPending')}</span>}
      </div>
      {failed && <div className="text-amber-300">{t('form.previewFailed')}</div>}
      {s && issues.length === 0 && (
        <dl className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div><dt className="text-ink-500">{t('summary.monthly')}</dt><dd className="font-mono private">{fmt(s.currentPaymentWithInsurance)}</dd></div>
          <div><dt className="text-ink-500">{t('summary.endDate')}</dt><dd>{formatMonth(s.endDate)}</dd></div>
          <div><dt className="text-ink-500">{t('summary.interest')}</dt><dd className="font-mono private">{fmt(s.totals.interest)}</dd></div>
          <div><dt className="text-ink-500">{t('summary.insurance')}</dt><dd className="font-mono private">{fmt(s.totals.insurance)}</dd></div>
          <div><dt className="text-ink-500">{t('summary.cost')}</dt><dd className="font-mono private">{fmt(s.totals.cost)}</dd></div>
        </dl>
      )}
      {notes.length > 0 && (
        <ul className="space-y-1">
          {notes.map((n, i) => <li key={`${n.code}-${i}`} className="text-amber-300">{t(`issues.${n.code}`)}</li>)}
        </ul>
      )}
    </section>
  );
}
