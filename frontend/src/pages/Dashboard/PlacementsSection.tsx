import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Account } from '../../api/types';
import { getInvestmentsTimeseries } from '../../api/investments';
import { formatAmount } from '../../lib/format';
import { formatGainPct, numberLocale } from '../Accounts/valuation-lib';
import { fromDateFor, RangePicker, type RangeKey } from '../../components/RangePicker';
import { SectionRule } from '../../components/SectionRule';
import { ChartSkeleton, ErrorState } from '../../components/StateBlocks';
import { AccountSelect } from './AccountSelect';
import { PlacementsChart } from './placements/PlacementsChart';
import { signedAmount } from './placements/PlacementsTooltip';
import { granularityFor, pickPlacementSeries, summarizePlacements } from './placements/series';

interface Props {
  accounts: Account[];
  displayCurrency: string | null;
  primaryCurrency?: string;
  defaultRange: RangeKey;
}

export const isPlacementAccount = (a: Account): boolean => a.type === 'investment' || a.type === 'savings';

// Dashboard "Placements" section: Valeur vs Versé over time for investment
// and savings accounts. Owns its account + range controls (the page-wide
// scope bar targets the balance-based charts, which exclude these semantics).
export function PlacementsSection({ accounts, displayCurrency, primaryCurrency, defaultRange }: Props): JSX.Element | null {
  const { t, i18n } = useTranslation('dashboard');
  const eligible = useMemo(() => accounts.filter(isPlacementAccount), [accounts]);
  const [range, setRange] = useState<RangeKey>(defaultRange);
  const [scope, setScope] = useState<'all' | 'available' | number>('all');
  const accountId = typeof scope === 'number' && eligible.some((a) => a.id === scope) ? scope : undefined;
  const fromDate = fromDateFor(range);
  const granularity = granularityFor(range);

  const q = useQuery({
    queryKey: ['reports', 'investments-timeseries', accountId ?? 'all', fromDate ?? 'all', granularity, displayCurrency],
    queryFn: () => getInvestmentsTimeseries({ fromDate, granularity, accountId, display: displayCurrency }),
    enabled: eligible.length > 0,
  });

  const series = useMemo(() => {
    const scopedCurrency = accountId !== undefined ? eligible.find((a) => a.id === accountId)?.currency : primaryCurrency;
    return pickPlacementSeries(q.data, scopedCurrency);
  }, [q.data, accountId, eligible, primaryCurrency]);
  const summary = series ? summarizePlacements(series.points) : null;

  if (eligible.length === 0) return null;
  const currency = series?.currency ?? primaryCurrency ?? 'EUR';

  return (
    <section id="dash-placements" className="surface p-5 md:p-6 relative scroll-mt-24">
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <SectionRule className="flex-1">{t('placements.title', { currency })}</SectionRule>
        <div role="group" aria-label={t('placements.scopeAria')} className="flex items-center gap-2 flex-wrap">
          <AccountSelect value={scope} onChange={setScope} accounts={eligible} hideAvailable />
          <RangePicker value={range} onChange={setRange} />
        </div>
      </div>
      {q.isError ? (
        <ErrorState variant="inline" error={q.error} onRetry={() => void q.refetch()} />
      ) : series ? (
        <>
          <PlacementsChart points={series.points} currency={currency} granularity={granularity} />
          {summary && (
            <p data-testid="placements-summary" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs tabular-nums text-ink-400">
              <span>{t('placements.summary.value')} <span className="text-ink-100 private">{formatAmount(summary.value, currency)}</span></span>
              <span>{t('placements.summary.contributed')} <span className="text-ink-200 private">{formatAmount(summary.contributed, currency)}</span></span>
              <span>
                {t('placements.summary.gain')}{' '}
                <span className={`private ${summary.gain > 0 ? 'text-sage-300' : summary.gain < 0 ? 'text-clay-300' : 'text-ink-200'}`}>
                  {signedAmount(summary.gain, currency)}
                  {summary.gainPct !== null && ` (${formatGainPct(summary.gainPct, numberLocale(i18n.language))})`}
                </span>
              </span>
            </p>
          )}
        </>
      ) : q.isLoading ? (
        <ChartSkeleton />
      ) : (
        <div className="text-sm text-ink-500 py-12 text-center font-display italic">{t('placements.empty')}</div>
      )}
    </section>
  );
}
