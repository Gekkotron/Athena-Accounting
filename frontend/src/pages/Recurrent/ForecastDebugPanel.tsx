import type { RecurringSeries } from '../../api/types';
import type { ForecastPoint } from '../../lib/recurring-forecast';
import { monthlyEquivalent } from './lib';
import { contributingSeries, type Horizon } from './forecast-lib';

// Debug panel — a stopgap when the projection looks wrong. Renders every
// input the projection sees (start balance, per-series lastSeenAt / cadence /
// avgAmount) plus the day-by-day contributions that drive the curve. Toggle
// with the [debug] link at the bottom of the tab, or open the page with
// `?debug=1` in the query string.
export function ForecastDebugPanel({
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
  const contributing = contributingSeries(activeSeries, includeDetected);

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
