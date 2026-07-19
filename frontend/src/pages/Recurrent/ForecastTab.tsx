import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Account, BalancePoint, RecurringSeries } from '../../api/types';
import { BalanceChart } from '../../components/BalanceChart';
import { ErrorState, LoadingBlock, EmptyState } from '../../components/StateBlocks';
import { AccountSelect } from '../Dashboard/AccountSelect';
import { amountSignClass, formatAmount } from '../../lib/format';
import { projectBalance, type ForecastPoint } from '../../lib/recurring-forecast';
import { monthlyEquivalent } from './lib';

type Horizon = 30 | 60 | 90 | 180;
const HORIZONS: Horizon[] = [30, 60, 90, 180];

// Historical window shown on the chart before the projection kicks in.
const HISTORICAL_WINDOW_DAYS = 90;

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  const t = d.getTime() - days * 86_400_000;
  const dt = new Date(t);
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function ForecastTab(): JSX.Element {
  const [horizon, setHorizon] = useState<Horizon>(60);
  const [scope, setScope] = useState<'all' | number>('all');
  const [includeDetected, setIncludeDetected] = useState(false);
  const [debug, setDebug] = useState<boolean>(
    typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('debug') === '1',
  );

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const balanceQ = useQuery({
    queryKey: ['reports', 'balance'],
    queryFn: () => api<{ perCurrency: { currency: string; total: string }[] }>('/api/reports/balance'),
  });
  const timeseriesQ = useQuery({
    queryKey: ['reports', 'timeseries'],
    queryFn: () => api<{ points: BalancePoint[] }>('/api/reports/timeseries', { query: { granularity: 'day' } }),
  });
  const seriesQ = useQuery({
    queryKey: ['recurring'],
    queryFn: () => api<{ recurring: RecurringSeries[] }>('/api/recurring'),
  });

  const accounts = accountsQ.data?.accounts ?? [];
  const primaryCurrency = balanceQ.data?.perCurrency?.[0]?.currency ?? 'EUR';

  const currency = useMemo(() => {
    if (scope === 'all') return primaryCurrency;
    const acc = accounts.find((a) => a.id === scope);
    return acc?.currency ?? primaryCurrency;
  }, [scope, accounts, primaryCurrency]);

  const startBalance = useMemo(() => {
    if (scope === 'all') {
      const total = balanceQ.data?.perCurrency?.find((c) => c.currency === currency)?.total ?? '0';
      return Number(total);
    }
    const acc = accounts.find((a) => a.id === scope);
    if (!acc) return 0;
    return Number(acc.currentBalance ?? acc.openingBalance ?? 0);
  }, [scope, accounts, balanceQ.data, currency]);

  // All non-dismissed series feed the counters/UI; the projection helper
  // then applies its own confirmed-only default (see includeDetected).
  // When the scope is narrowed to a specific account, series whose
  // primary account is a different account are dropped — otherwise a
  // salary that only lands on Checking would inflate the Savings
  // projection. Series with a null primaryAccountId (unknown) fall
  // through to the current behaviour so backwards-compat with older
  // backend payloads is preserved.
  const activeSeries = useMemo(() => {
    const all = (seriesQ.data?.recurring ?? []).filter((s) => s.status !== 'dismissed');
    if (scope === 'all') return all;
    return all.filter((s) => s.primaryAccountId == null || s.primaryAccountId === scope);
  }, [seriesQ.data, scope]);

  const contributingCount = useMemo(() => {
    return activeSeries.filter((s) => includeDetected || s.status === 'confirmed').length;
  }, [activeSeries, includeDetected]);

  const today = todayIso();

  const rawForecast = useMemo<ForecastPoint[]>(() => {
    return projectBalance({
      startBalance,
      series: activeSeries,
      horizonDays: horizon,
      startDate: today,
      includeDetected,
    });
  }, [startBalance, activeSeries, horizon, today, includeDetected]);

  const forecastPoints = useMemo(() => {
    // The projection helper emits daily samples; the chart's dashed run
    // renders them all. Skip index 0 (today) since the historical line
    // already ends there — otherwise the transition point renders twice.
    return rawForecast.slice(1).map((p) => ({ date: p.date, value: p.projectedBalance }));
  }, [rawForecast]);

  const scopedHistoricalPoints = useMemo<BalancePoint[]>(() => {
    const all = timeseriesQ.data?.points ?? [];
    const cutoff = isoDaysAgo(HISTORICAL_WINDOW_DAYS);
    const scoped = scope === 'all' ? all : all.filter((p) => p.account_id === scope);
    return scoped.filter((p) => p.bucket >= cutoff);
  }, [timeseriesQ.data, scope]);

  const projectedEndBalance = forecastPoints.length > 0
    ? forecastPoints[forecastPoints.length - 1]!.value
    : startBalance;
  const variation = projectedEndBalance - startBalance;

  if (accountsQ.isLoading || balanceQ.isLoading || timeseriesQ.isLoading || seriesQ.isLoading) {
    return <LoadingBlock />;
  }
  if (accountsQ.error || balanceQ.error) {
    return (
      <ErrorState
        error={accountsQ.error ?? balanceQ.error}
        onRetry={() => {
          void accountsQ.refetch();
          void balanceQ.refetch();
        }}
      />
    );
  }

  if (contributingCount === 0) {
    const hasDetectedButNoConfirmed = activeSeries.length > 0 && !includeDetected;
    return (
      <EmptyState
        title={hasDetectedButNoConfirmed
          ? "Aucune série confirmée pour l'instant."
          : "Aucune série récurrente pour projeter le solde."}
        hint={
          hasDetectedButNoConfirmed
            ? "La projection n'utilise que les séries que vous avez confirmées, pour éviter que des détections approximatives ne faussent le résultat. Ouvrez l'onglet Détectés et confirmez vos vraies séries récurrentes — ou activez « inclure les séries détectées » ci-dessous pour projeter avec l'ensemble."
            : "Confirmez d'abord vos séries récurrentes depuis l'onglet Détectés — la projection utilise leurs cadences et montants pour extrapoler la trajectoire de votre solde."
        }
        action={
          hasDetectedButNoConfirmed ? (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setIncludeDetected(true)}
            >
              Inclure les séries détectées
            </button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="surface p-4 md:p-5">
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.18em] text-ink-500">
            Projection du solde ({currency})
          </span>
          <div className="flex-1 h-px bg-ink-800" />
          <div className="flex items-center gap-2 flex-wrap">
            <label
              className="flex items-center gap-1.5 text-xs text-ink-400 cursor-pointer select-none"
              title="Par défaut, seules les séries confirmées alimentent la projection. Activez pour inclure aussi les séries détectées non-confirmées."
            >
              <input
                type="checkbox"
                checked={includeDetected}
                onChange={(e) => setIncludeDetected(e.target.checked)}
                className="accent-sage-500"
              />
              Inclure séries détectées
            </label>
            <AccountSelect
              value={scope}
              onChange={setScope}
              accounts={accounts}
              primaryCurrency={primaryCurrency}
            />
            <HorizonPicker value={horizon} onChange={setHorizon} />
          </div>
        </div>
        <div className="text-[11px] text-ink-500 mb-3">
          Projection basée sur {contributingCount} série{contributingCount > 1 ? 's' : ''}{' '}
          {includeDetected ? 'active' : 'confirmée'}{contributingCount > 1 ? 's' : ''}.
        </div>
        {timeseriesQ.error ? (
          <ErrorState variant="inline" error={timeseriesQ.error} onRetry={() => void timeseriesQ.refetch()} />
        ) : (
          <BalanceChart
            points={scopedHistoricalPoints}
            projection={forecastPoints}
            currency={currency}
            alignEndTo={startBalance}
          />
        )}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="surface-soft px-4 py-3">
          <div className="label">Solde prévu à J+{horizon}</div>
          <div className={`display text-xl mt-0.5 tabular-nums ${amountSignClass(projectedEndBalance)}`}>
            {formatAmount(projectedEndBalance, currency)}
          </div>
        </div>
        <div className="surface-soft px-4 py-3">
          <div className="label">Variation prévue</div>
          <div className={`display text-xl mt-0.5 tabular-nums ${amountSignClass(variation)}`}>
            {variation >= 0 ? '+' : ''}
            {formatAmount(variation, currency)}
          </div>
        </div>
      </section>

      <div className="text-right">
        <button
          type="button"
          onClick={() => setDebug((d) => !d)}
          className="text-[10px] uppercase tracking-[0.18em] text-ink-500 hover:text-ink-200 underline-offset-2 hover:underline"
        >
          {debug ? '[hide debug]' : '[debug]'}
        </button>
      </div>

      {debug && (
        <ForecastDebugPanel
          today={today}
          horizon={horizon}
          startBalance={startBalance}
          currency={currency}
          scope={scope}
          includeDetected={includeDetected}
          activeSeries={activeSeries}
          rawForecast={rawForecast}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Debug panel — a stopgap when the projection looks wrong. Renders every
// input the projection sees (start balance, per-series lastSeenAt / cadence /
// avgAmount) plus the day-by-day contributions that drive the curve. Toggle
// with the [debug] link at the bottom of the tab, or open the page with
// `?debug=1` in the query string.
// ---------------------------------------------------------------------------

function ForecastDebugPanel({
  today,
  horizon,
  startBalance,
  currency,
  scope,
  includeDetected,
  activeSeries,
  rawForecast,
}: {
  today: string;
  horizon: Horizon;
  startBalance: number;
  currency: string;
  scope: 'all' | number;
  includeDetected: boolean;
  activeSeries: RecurringSeries[];
  rawForecast: ForecastPoint[];
}): JSX.Element {
  const contributing = activeSeries.filter(
    (s) => includeDetected || s.status === 'confirmed',
  );

  const daysWithActivity = rawForecast.filter((p) => p.contributions.length > 0);
  const lastPoint = rawForecast[rawForecast.length - 1];
  const netProjected = (lastPoint?.projectedBalance ?? startBalance) - startBalance;
  const netMonthly = horizon > 0 ? (netProjected * 30) / horizon : 0;

  const seriesById = new Map<number, RecurringSeries>();
  for (const s of activeSeries) seriesById.set(s.id, s);

  return (
    <section className="surface p-4 md:p-5 text-xs font-mono">
      <header className="pb-3 mb-3 border-b border-ink-800/70">
        <span className="display text-base text-ink-100">Debug — forecast inputs</span>
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 mt-1">
          A raw dump of everything projectBalance() sees. Nothing here is user-visible copy — treat it as diagnostics.
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-y-1 gap-x-4 mb-4">
        <span className="text-ink-500">today</span>            <span className="col-span-3">{today}</span>
        <span className="text-ink-500">horizon</span>          <span className="col-span-3">{horizon} days</span>
        <span className="text-ink-500">startBalance</span>     <span className="col-span-3 tabular-nums">{startBalance.toFixed(2)} {currency}</span>
        <span className="text-ink-500">projected end</span>    <span className="col-span-3 tabular-nums">{(lastPoint?.projectedBalance ?? startBalance).toFixed(2)} {currency}</span>
        <span className="text-ink-500">Δ over horizon</span>   <span className="col-span-3 tabular-nums">{netProjected >= 0 ? '+' : ''}{netProjected.toFixed(2)} {currency}</span>
        <span className="text-ink-500">Δ monthly (30d)</span>  <span className="col-span-3 tabular-nums">{netMonthly >= 0 ? '+' : ''}{netMonthly.toFixed(2)} {currency}</span>
        <span className="text-ink-500">scope</span>            <span className="col-span-3">{scope === 'all' ? 'all accounts' : `account ${scope}`}</span>
        <span className="text-ink-500">includeDetected</span>  <span className="col-span-3">{includeDetected ? 'true (detected series feed the curve)' : 'false (only confirmed contribute)'}</span>
        <span className="text-ink-500">active series</span>    <span className="col-span-3">{activeSeries.length} (of which {contributing.length} contribute)</span>
      </div>

      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-ink-500">
        Series ({activeSeries.length})
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] tabular-nums">
          <thead className="text-ink-500 text-left">
            <tr>
              <th className="pr-3 py-1 font-normal">id</th>
              <th className="pr-3 py-1 font-normal">label</th>
              <th className="pr-3 py-1 font-normal">status</th>
              <th className="pr-3 py-1 font-normal text-right">avgAmount</th>
              <th className="pr-3 py-1 font-normal">cadence</th>
              <th className="pr-3 py-1 font-normal">acct</th>
              <th className="pr-3 py-1 font-normal">lastSeenAt</th>
              <th className="pr-3 py-1 font-normal">nextDueAt</th>
              <th className="pr-3 py-1 font-normal text-right">eq/30d</th>
              <th className="pr-3 py-1 font-normal">contrib?</th>
            </tr>
          </thead>
          <tbody>
            {activeSeries.map((s) => {
              const contribs = contributing.some((c) => c.id === s.id);
              const eq = monthlyEquivalent(s);
              return (
                <tr key={s.id} className={contribs ? 'text-ink-200' : 'text-ink-500'}>
                  <td className="pr-3 py-1">{s.id}</td>
                  <td className="pr-3 py-1 truncate max-w-[16rem]">{s.label}</td>
                  <td className="pr-3 py-1">{s.status}</td>
                  <td className="pr-3 py-1 text-right">{Number(s.avgAmount).toFixed(2)}</td>
                  <td className="pr-3 py-1">{s.cadenceDays}d</td>
                  <td className="pr-3 py-1">{s.primaryAccountId ?? '—'}</td>
                  <td className="pr-3 py-1">{s.lastSeenAt}</td>
                  <td className="pr-3 py-1">{s.nextDueAt}</td>
                  <td className="pr-3 py-1 text-right">{eq >= 0 ? '+' : ''}{eq.toFixed(2)}</td>
                  <td className="pr-3 py-1">{contribs ? 'yes' : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-5 mb-2 text-[10px] uppercase tracking-[0.18em] text-ink-500">
        Contributions ({daysWithActivity.length} days)
      </div>
      {daysWithActivity.length === 0 ? (
        <div className="text-ink-500">
          No projected occurrences in this horizon. Either all confirmed series have
          their next occurrence past J+{horizon}, or nothing is confirmed.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] tabular-nums">
            <thead className="text-ink-500 text-left">
              <tr>
                <th className="pr-3 py-1 font-normal">date</th>
                <th className="pr-3 py-1 font-normal">series → amount</th>
                <th className="pr-3 py-1 font-normal text-right">day total</th>
                <th className="pr-3 py-1 font-normal text-right">running balance</th>
              </tr>
            </thead>
            <tbody>
              {daysWithActivity.map((p) => {
                const dayTotal = p.contributions.reduce((s, c) => s + c.amount, 0);
                return (
                  <tr key={p.date} className="text-ink-200">
                    <td className="pr-3 py-1">{p.date}</td>
                    <td className="pr-3 py-1">
                      {p.contributions
                        .map((c) => {
                          const name = seriesById.get(c.seriesId)?.label ?? `#${c.seriesId}`;
                          return `${name} ${c.amount >= 0 ? '+' : ''}${c.amount.toFixed(2)}`;
                        })
                        .join(' · ')}
                    </td>
                    <td className="pr-3 py-1 text-right">{dayTotal >= 0 ? '+' : ''}{dayTotal.toFixed(2)}</td>
                    <td className="pr-3 py-1 text-right">{p.projectedBalance.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function HorizonPicker({
  value,
  onChange,
}: {
  value: Horizon;
  onChange: (v: Horizon) => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-ink-800/70 p-0.5 text-xs">
      {HORIZONS.map((h) => (
        <button
          key={h}
          type="button"
          onClick={() => onChange(h)}
          className={`px-2 py-1 rounded-md transition ${
            value === h ? 'bg-ink-800 text-ink-50' : 'text-ink-400 hover:text-ink-100'
          }`}
        >
          J+{h}
        </button>
      ))}
    </div>
  );
}
