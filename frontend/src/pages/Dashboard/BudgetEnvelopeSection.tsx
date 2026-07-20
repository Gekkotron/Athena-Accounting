import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useEnvelopeReport } from '../../lib/useEnvelopes';
import { formatAmount } from '../../lib/format';
import { formatSignedMoney } from '../Budgets/envelope-math';

function currentMonthYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function BudgetEnvelopeSection(): JSX.Element | null {
  const { t, i18n } = useTranslation('dashboard');
  const month = currentMonthYm();
  const q = useEnvelopeReport(month);
  const data = q.data;

  if (!data) return null;
  const hasAnything =
    data.rows.length > 0 ||
    Number(data.pool.available) !== 0 ||
    Number(data.pool.incomeCumulative) > 0;
  if (!hasAnything) return null;

  const overspentCount = data.rows.filter((r) => r.overspent).length;
  const negative = Number(data.pool.available) < 0;
  const income = Number(data.pool.incomeCumulative);
  const assigned = Number(data.pool.assignedCumulative);
  const pct = income > 0 ? Math.min(1, assigned / income) : 0;
  // Mirrors Dashboard/insights.ts's monthLabel and Budgets/Enveloppes's
  // formatMonthLabel: locale-name choice, not a translatable string, so no
  // vocabulary entry needed — just the standard CLDR month names.
  const locale = i18n.language.startsWith('en') ? 'en-US' : 'fr-FR';

  return (
    <section className="surface p-6 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="label">{t('envelopeTile.header')}</div>
          <div className="text-sm text-ink-400 capitalize">{new Date(month + '-01').toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</div>
        </div>
        <Link className="text-sage-300 text-sm hover:underline" to={`/budgets/envelopes?month=${month}`}>
          {t('envelopeTile.actions.viewAll')}
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <div className="label">{t('envelopeTile.stats.available')}</div>
          <div className={`display text-2xl ${negative ? 'text-clay-300' : 'text-ink-50'}`}>
            {formatSignedMoney(data.pool.available)}
          </div>
        </div>
        <div>
          <div className="label">{t('envelopeTile.stats.assigned')}</div>
          <div className="text-xl">{formatAmount(data.pool.assignedCumulative)}</div>
          <div className="h-1.5 mt-1 bg-ink-800 rounded">
            <div className="h-full bg-sage-500 rounded" style={{ width: `${(pct * 100).toFixed(0)}%` }} />
          </div>
        </div>
        <div>
          <div className="label">{t('envelopeTile.stats.overBudget')}</div>
          <Link to={`/budgets/envelopes?month=${month}`}
                className={`text-xl inline-flex items-center gap-1 ${overspentCount > 0 ? 'text-clay-300' : 'text-ink-400'}`}>
            {t('envelopeTile.stats.overBudgetCount', { count: overspentCount })}
            {overspentCount > 0 && <span aria-hidden>⚠</span>}
          </Link>
        </div>
        <div>
          <div className="label">{t('envelopeTile.stats.held')}</div>
          <div className={`text-xl ${Number(data.pool.heldForNextMonth) === 0 ? 'text-ink-500' : 'text-ink-100'}`}>
            {formatAmount(data.pool.heldForNextMonth)}
          </div>
        </div>
      </div>
    </section>
  );
}
