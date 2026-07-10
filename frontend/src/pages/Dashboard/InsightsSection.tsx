import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { CategoryReportRow, BudgetReportRow } from '../../api/types';
import { Sparkline } from '../../components/Sparkline';
import { AVG_WINDOW_MONTHS, monthAgoISODate, lastDayOfPrevMonthISODate } from './helpers';
import { buildInsights, monthLabel, type InsightTone } from './insights';

const TONE_CLASS: Record<InsightTone, string> = {
  sage: 'text-sage-300',
  clay: 'text-clay-300',
  neutral: 'text-ink-400',
};

// The chronological complete-month window: `count` months ending at the last
// complete month (current month - 1). Matches the fromDate/toDate fetch below.
function completeMonthWindow(count: number, now: Date): string[] {
  const keys: string[] = [];
  for (let i = count; i >= 1; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

interface Props {
  currency: string;
}

export function InsightsSection({ currency }: Props): JSX.Element | null {
  const months = useMemo(() => completeMonthWindow(AVG_WINDOW_MONTHS, new Date()), []);
  const referenceMonth = months[months.length - 1];
  const fromDate = monthAgoISODate(AVG_WINDOW_MONTHS);
  const toDate = lastDayOfPrevMonthISODate();

  const catQ = useQuery({
    queryKey: ['reports', 'categories', { fromDate, toDate }],
    queryFn: () =>
      api<{ rows: CategoryReportRow[] }>('/api/reports/categories', { query: { fromDate, toDate } }),
  });
  const budgetQ = useQuery({
    queryKey: ['reports', 'budget', { month: referenceMonth }],
    queryFn: () =>
      api<{ rows: BudgetReportRow[] }>('/api/reports/budget', { query: { month: referenceMonth } }),
  });

  const insights = useMemo(
    () =>
      buildInsights(
        catQ.data?.rows ?? [],
        budgetQ.data?.rows ?? [],
        months,
        referenceMonth,
        currency,
      ),
    [catQ.data, budgetQ.data, months, referenceMonth, currency],
  );

  if (catQ.isLoading) {
    return (
      <section>
        <div className="section-rule mb-4">Insights</div>
        <div className="h-32 animate-pulse rounded-lg bg-ink-900" />
      </section>
    );
  }

  return (
    <section>
      <div className="section-rule mb-4">
        Insights{' '}
        <span className="text-ink-500 font-normal text-xs normal-case tracking-normal">
          — {monthLabel(referenceMonth)}
        </span>
      </div>

      {catQ.isError ? (
        <div className="surface p-5 text-sm text-clay-300">
          Erreur de chargement des insights.
        </div>
      ) : insights.length === 0 ? (
        <div className="surface p-5 text-sm text-ink-400 display-italic">
          Rien de notable ce mois-ci.
        </div>
      ) : (
        <div className="surface divide-y divide-ink-850">
          {insights.map((ins) => (
            <div key={ins.key} className="flex items-start gap-3 px-4 py-3">
              <span className="text-lg leading-none" aria-hidden>
                {ins.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-ink-100">{ins.headline}</div>
                {ins.detail && (
                  <div className={`text-sm ${TONE_CLASS[ins.tone]}`}>{ins.detail}</div>
                )}
              </div>
              {ins.spark && (
                <Sparkline values={ins.spark} aria-label={`tendance ${monthLabel(referenceMonth)}`} />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
