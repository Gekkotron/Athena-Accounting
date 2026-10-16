import { useTranslation } from 'react-i18next';
import type { LoanListItem } from '../../api/loans';
import { formatAmount, formatDate, formatMonth } from '../../lib/format';

const BADGE = 'rounded px-1.5 py-0.5 text-[10px] bg-ink-800 text-ink-300';

export function LoanCard({ loan, onOpen }: { loan: LoanListItem; onOpen: (id: number) => void }) {
  const { t } = useTranslation('loans');
  const s = loan.summary;
  const pct = s ? Math.round(s.today.repaidPct) : 0;
  return (
    <button
      type="button"
      onClick={() => onOpen(loan.id)}
      aria-label={loan.name}
      className="surface p-4 w-full text-left hover:border-ink-500 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink-100 truncate">{loan.name}</div>
          <div className="text-[11px] text-ink-500">{t(`kind.${loan.kind}`)}</div>
        </div>
        <div className="flex gap-1 shrink-0">
          {loan.isSimulation && <span className={BADGE}>{t('badge.simulation')}</span>}
          {s?.today.status === 'repaid' && <span className={BADGE}>{t('badge.repaid')}</span>}
          {s?.today.status === 'not_started' && <span className={BADGE}>{t('badge.notStarted')}</span>}
        </div>
      </div>
      {s ? (
        <>
          <div className="mt-3 flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-ink-500">{t('card.owed')}</span>
            <span className="text-lg font-mono tabular-nums text-ink-100 private">
              {formatAmount(s.today.capitalOwed, loan.currency)}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('card.repaidPct', { pct })}
            className="mt-2 h-1.5 w-full rounded-full bg-ink-900 overflow-hidden"
          >
            <div className="h-full bg-sage-400" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-ink-500">{t('card.repaidPct', { pct })}</div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            <dt className="text-ink-500">{t('card.monthly')}</dt>
            <dd className="text-right font-mono tabular-nums private">
              {formatAmount(s.currentPaymentWithInsurance, loan.currency)}
            </dd>
            {s.today.nextInstalment && (
              <>
                <dt className="text-ink-500">{t('card.next')}</dt>
                <dd className="text-right">{formatDate(s.today.nextInstalment.date)}</dd>
              </>
            )}
            <dt className="text-ink-500">{t('card.endDate')}</dt>
            <dd className="text-right">{formatMonth(s.endDate)}</dd>
            <dt className="text-ink-500">{t('card.cost')}</dt>
            <dd className="text-right font-mono tabular-nums private">{formatAmount(s.totals.cost, loan.currency)}</dd>
          </dl>
        </>
      ) : (
        <div role="note" className="mt-3 text-xs text-amber-300">{t('card.invalid')}</div>
      )}
    </button>
  );
}
