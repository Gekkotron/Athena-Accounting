import { formatAmount, amountSignClass } from '../../lib/format';

interface Currency {
  currency: string;
  total: string;
  available: string;
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
  const blocked = total - available;
  const hasBlocked = Math.abs(blocked) >= 0.005;
  return (
    <section>
      <div className="label">{hasBlocked ? 'Disponible' : 'Solde net'}</div>
      <div className={`display text-5xl md:text-7xl leading-[1.05] mt-2 tabular-nums ${amountSignClass(available)}`}>
        {formatAmount(available, primary.currency)}
      </div>
      <div className="text-sm text-ink-500 mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span>
          <span className="display-italic">somme</span> de {primary.account_count} compte
          {primary.account_count > 1 ? 's' : ''} · {primary.currency}
        </span>
        {hasBlocked && (
          <span className="text-amber-300/90">
            + <span className="font-mono private">{formatAmount(blocked, primary.currency)}</span> bloqués
          </span>
        )}
      </div>
    </section>
  );
}
