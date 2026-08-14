import { formatAmount, amountSignClass } from '../../lib/format';
import { ConsolidatedTotalCard, type ConsolidatedBlock, type PerCurrencyRow } from './ConsolidatedTotalCard';

export type { ConsolidatedBlock, PerCurrencyRow };

interface Props {
  currencies: PerCurrencyRow[];
  consolidated: ConsolidatedBlock | null;
}

// Secondary-currency card strip below the hero. When a display currency is
// configured (`consolidated` present), every mapped currency collapses into
// one ConsolidatedTotalCard plus a small raw fallback card per currency the
// manual FX table couldn't convert. Otherwise every currency past the
// primary (already shown by DashboardHero) renders its own small card.
export function BalanceCardBlock({ currencies, consolidated }: Props): JSX.Element | null {
  if (consolidated) {
    return (
      <section className="flex flex-wrap gap-3 items-start">
        <ConsolidatedTotalCard consolidated={consolidated} currencyCount={currencies.length} />
        {consolidated.unmapped.map((c) => (
          <div key={c.currency} className="surface-soft px-4 py-3">
            <div className="label">{c.currency}</div>
            <div className={`display text-xl mt-0.5 tabular-nums ${amountSignClass(c.total)}`}>
              {formatAmount(c.total, c.currency)}
            </div>
          </div>
        ))}
      </section>
    );
  }
  if (currencies.length <= 1) return null;
  return (
    <section className="flex flex-wrap gap-3">
      {currencies.slice(1).map((c) => (
        <div key={c.currency} className="surface-soft px-4 py-3">
          <div className="label">{c.currency}</div>
          <div className={`display text-xl mt-0.5 tabular-nums ${amountSignClass(c.total)}`}>
            {formatAmount(c.total, c.currency)}
          </div>
        </div>
      ))}
    </section>
  );
}
