import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { Category, CategoryReportRow, BudgetReportRow } from '../../api/types';
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
  const { t, i18n } = useTranslation('dashboard');
  const lang = i18n.language?.startsWith('en') ? 'en' : 'fr';
  const months = useMemo(() => completeMonthWindow(AVG_WINDOW_MONTHS, new Date()), []);
  // 0 = last complete month; higher steps further back. Capped so a prior month
  // always remains in-window for the month-over-month comparison.
  const [monthOffset, setMonthOffset] = useState(0);
  const maxOffset = months.length - 2;
  const referenceMonth = months[months.length - 1 - Math.min(monthOffset, maxOffset)];
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
  const categoriesQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });

  const insights = useMemo(
    () =>
      buildInsights(
        catQ.data?.rows ?? [],
        categoriesQ.data?.categories ?? [],
        budgetQ.data?.rows ?? [],
        months,
        referenceMonth,
        currency,
        t,
        lang,
      ),
    [catQ.data, categoriesQ.data, budgetQ.data, months, referenceMonth, currency, t, lang],
  );

  if (catQ.isLoading) {
    return (
      <section>
        <div className="section-rule mb-4">{t('insights.title')}</div>
        <div className="h-32 animate-pulse rounded-lg bg-ink-900" />
      </section>
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="section-rule">
          {t('insights.title')}{' '}
          <span className="text-ink-500 font-normal text-xs normal-case tracking-normal">
            — {monthLabel(referenceMonth, lang)} {referenceMonth.slice(0, 4)}
          </span>
        </div>
        <div className="inline-flex rounded-lg border border-ink-800 bg-ink-900/60 p-0.5 text-xs">
          <button
            onClick={() => setMonthOffset((o) => Math.min(o + 1, maxOffset))}
            disabled={monthOffset >= maxOffset}
            className="px-2.5 py-1.5 rounded-md text-ink-400 transition hover:text-ink-100 disabled:opacity-30 disabled:hover:text-ink-400"
            aria-label={t('insights.prevMonth')}
          >
            ‹
          </button>
          <button
            onClick={() => setMonthOffset((o) => Math.max(o - 1, 0))}
            disabled={monthOffset === 0}
            className="px-2.5 py-1.5 rounded-md text-ink-400 transition hover:text-ink-100 disabled:opacity-30 disabled:hover:text-ink-400"
            aria-label={t('insights.nextMonth')}
          >
            ›
          </button>
        </div>
      </div>

      {catQ.isError ? (
        <div className="surface p-5 text-sm text-clay-300">
          {t('insights.loadError')}
        </div>
      ) : insights.length === 0 ? (
        <div className="surface p-5 text-sm text-ink-400 display-italic">
          {t('insights.empty')}
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
                <Sparkline
                  values={ins.spark}
                  aria-label={t('insights.trendAriaLabel', { month: monthLabel(referenceMonth, lang) })}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
