import { formatAmount, amountSignClass } from '../../lib/format';

interface Currency {
  currency: string;
  total: string;
  available: string;
  invested?: string;
  account_count: number;
}

interface Props {
  primary?: Currency;
}

export function DashboardHero({ primary }: Props): JSX.Element {
  if (!primary) {
    return (
      <section>
        <div className="label">Solde net</div>
        <div className="display text-5xl text-ink-700 mt-2">—</div>
      </section>
    );
  }
  const total = Number(primary.total);
  const available = Number(primary.available ?? primary.total);
  const invested = Number(primary.invested ?? 0);
  const blocked = total - available;
  const disponible = available - invested;
  const hasBlocked = Math.abs(blocked) >= 0.005;
  const hasInvested = Math.abs(invested) >= 0.005;
  // The hero amount defaults to `disponible` (Disponible strict) as soon as
  // either Placé or Bloqué is non-zero — that's the "vraiment liquide" figure
  // the user pointed at Binance/Kraken to solve for.
  const heroAmount = hasBlocked || hasInvested ? disponible : available;
  const heroLabel = hasBlocked || hasInvested ? 'Disponible' : 'Solde net';
  return (
    <section>
      <div className="label">{heroLabel}</div>
      <div className={`display text-5xl md:text-7xl leading-[1.05] mt-2 tabular-nums ${amountSignClass(heroAmount)}`}>
        {formatAmount(heroAmount, primary.currency)}
      </div>
      <div className="text-sm text-ink-500 mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span>
          <span className="display-italic">somme</span> de {primary.account_count} compte
          {primary.account_count > 1 ? 's' : ''} · {primary.currency}
        </span>
        {hasInvested && (
          <span className="text-sky-300/90">
            + <span className="font-mono private">{formatAmount(invested, primary.currency)}</span> placés
          </span>
        )}
        {hasBlocked && (
          <span className="text-amber-300/90">
            + <span className="font-mono private">{formatAmount(blocked, primary.currency)}</span> bloqués
          </span>
        )}
      </div>
    </section>
  );
}
