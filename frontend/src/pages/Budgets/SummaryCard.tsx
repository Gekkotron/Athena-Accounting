import type { BudgetReport } from '../../api/types';
import { formatAmount } from '../../lib/format';
import { normalizeSparkline, summarizePace } from './budget-math';

function summedHistory(rows: BudgetReport['rows']): string[] {
  const first = rows.find((r) => r.history)?.history;
  const width = first ? first.values.length : 0;
  if (!width) return [];
  const sums = new Array<number>(width).fill(0);
  for (const r of rows) {
    if (!r.history) continue;
    r.history.values.forEach((v, i) => { sums[i] = (sums[i] ?? 0) + Number(v); });
  }
  // Append the current period spend as an extra bar so the chart shows
  // "here's where we are now" alongside the six historic periods.
  const currentSum = rows.reduce((a, r) => a + Number(r.spent), 0);
  return [...sums.map((n) => n.toFixed(2)), currentSum.toFixed(2)];
}

export function SummaryCard(props: {
  totals: BudgetReport['totals'];
  rows: BudgetReport['rows'];
  period: BudgetReport['period'];
  monthOrYear: string;
}): JSX.Element {
  const { totals, rows, period } = props;
  const pace = summarizePace(totals);
  const bars = normalizeSparkline(summedHistory(rows));
  const label = period === 'monthly' ? 'Ce mois-ci' : 'Cette année';

  const bg = pace === 'over' ? 'bg-amber-900/20 border-amber-800/40'
           : pace === 'onTrack' ? 'bg-sage-900/20 border-sage-800/40'
           : 'bg-ink-900/40 border-ink-800/60';

  return (
    <div className={`surface p-4 border ${bg} flex flex-col gap-3`}>
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-ink-400">{label}</span>
        <span className="text-lg tabular-nums private">
          {formatAmount(totals.spent)} / {formatAmount(totals.limit)}
        </span>
      </div>

      {totals.projected != null && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-400">Projection</span>
          <span className="tabular-nums private">
            ~{formatAmount(totals.projected)}
            {pace === 'over' && <span className="ml-2 text-amber-300">· Dépassement projeté</span>}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between text-sm">
        <span className="text-ink-400">Reste</span>
        <span className="tabular-nums private">{formatAmount(totals.remaining)}</span>
      </div>

      {bars.length > 0 && (
        <svg viewBox="0 0 100 24" className="w-full h-6" preserveAspectRatio="none" aria-hidden="true">
          {bars.map((b, i) => (
            <rect
              key={i}
              data-testid="summary-mini-bar"
              x={i * (100 / bars.length) + 0.5}
              y={24 - b.height * 22}
              width={100 / bars.length - 1}
              height={Math.max(1, b.height * 22)}
              className={b.isCurrent
                ? (pace === 'over' ? 'fill-amber-400' : 'fill-sage-400')
                : 'fill-ink-500'}
              rx="1"
            />
          ))}
        </svg>
      )}
    </div>
  );
}
