import { useTranslation } from 'react-i18next';
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

// Hero figure for the dashboard. When every account is unlocked and nothing
// is invested, the headline is Solde net = Available. As soon as the user
// has blocked or invested funds (crypto on an exchange, bank sub-pot, …)
// the headline silently switches to Disponible strict — the "truly liquid"
// figure — and a mini-grid underneath makes the breakdown explicit so the
// label change isn't a magic trick.
export function DashboardHero({ primary }: Props): JSX.Element {
  const { t } = useTranslation('dashboard');
  if (!primary) {
    return (
      <section>
        <div className="label">{t('hero.netBalance')}</div>
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
  const showBreakdown = hasBlocked || hasInvested;
  // The hero amount defaults to `disponible` (Disponible strict) as soon as
  // either Placé or Bloqué is non-zero — that's the "vraiment liquide" figure
  // the user pointed at Binance/Kraken to solve for.
  const heroAmount = showBreakdown ? disponible : available;
  const heroLabel = showBreakdown ? t('hero.available') : t('hero.netBalance');
  return (
    <section>
      <div className="label">{heroLabel}</div>
      <div className={`display text-5xl md:text-7xl leading-[1.05] mt-2 tabular-nums ${amountSignClass(heroAmount)}`}>
        {formatAmount(heroAmount, primary.currency)}
      </div>
      <div className="text-sm text-ink-500 mt-3">
        <span className="display-italic">{t('hero.sumWord')}</span>{' '}
        {t('hero.accountsSuffix', { count: primary.account_count, currency: primary.currency })}
      </div>
      {showBreakdown && (
        <dl className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 max-w-xl">
          <HeroStat label={t('hero.labels.total')} value={total} currency={primary.currency} tone="ink" />
          {hasInvested && (
            <HeroStat label={t('hero.labels.invested')} value={invested} currency={primary.currency} tone="sky" />
          )}
          {hasBlocked && (
            <HeroStat label={t('hero.labels.blocked')} value={blocked} currency={primary.currency} tone="amber" />
          )}
          <HeroStat label={t('hero.labels.available')} value={disponible} currency={primary.currency} tone="sage" />
        </dl>
      )}
    </section>
  );
}

const TONE_CLASS = {
  ink: 'text-ink-200',
  sky: 'text-sky-300',
  amber: 'text-amber-300',
  sage: 'text-sage-300',
} as const;

function HeroStat({
  label, value, currency, tone,
}: {
  label: string;
  value: number;
  currency: string;
  tone: keyof typeof TONE_CLASS;
}): JSX.Element {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className={`font-mono text-sm mt-0.5 tabular-nums private ${TONE_CLASS[tone]}`}>
        {formatAmount(value, currency)}
      </dd>
    </div>
  );
}
