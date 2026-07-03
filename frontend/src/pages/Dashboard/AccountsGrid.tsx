import { Link } from 'react-router-dom';
import type { Account } from '../../api/types';
import { formatAmount, amountSignClass, formatDate } from '../../lib/format';

interface Props {
  accounts: Account[];
  accountBaseline: Map<number, number>;
  rangeFromDate?: string;
  rangeSuffix: string;
}

export function AccountsGrid({ accounts, accountBaseline, rangeFromDate, rangeSuffix }: Props): JSX.Element {
  return (
    <section>
      <div className="section-rule mb-4">Comptes</div>
      {accounts.length === 0 ? (
        <div className="surface p-6 text-sm text-ink-400">
          <span className="display-italic">Aucun compte</span> — commencez par en créer un dans l'onglet
          « Comptes ».
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {accounts.map((a) => {
            const opening = Number(a.openingBalance);
            const baseline = rangeFromDate ? accountBaseline.get(a.id) ?? opening : opening;
            return <AccountCard key={a.id} account={a} baseline={baseline} rangeSuffix={rangeSuffix} />;
          })}
        </div>
      )}
    </section>
  );
}

interface CardProps {
  account: Account;
  baseline: number;
  rangeSuffix: string;
}

function AccountCard({ account: a, baseline, rangeSuffix }: CardProps): JSX.Element {
  const current = Number(a.currentBalance ?? '0');
  const available = Number(a.availableBalance ?? a.currentBalance ?? '0');
  const blocked = current - available;
  const hasBlocked = Math.abs(blocked) >= 0.005;
  const opening = Number(a.openingBalance);
  const delta = current - baseline;
  const hasMovement = Math.abs(delta) >= 0.005;
  const total = a.transactionCount ?? 0;
  const counted = a.countedTransactionCount ?? 0;
  const excluded = total - counted;
  return (
    <div className="surface p-5 group hover:border-ink-700 transition">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-medium text-ink-100 truncate">{a.name}</div>
        <span className="badge">{a.currency}</span>
      </div>
      <div className="text-[11px] text-ink-500 mt-0.5 uppercase tracking-wider">{a.type}</div>

      <div className="mt-4">
        <div className="label mb-0.5">Solde courant</div>
        <div className={`display text-3xl tabular-nums ${amountSignClass(current)}`}>
          {formatAmount(current, a.currency)}
        </div>
        {hasBlocked && (
          <div className="text-[11px] text-amber-300/90 mt-1 font-mono">
            dont <span className="private">{formatAmount(blocked, a.currency)}</span> bloqués
            {a.lockYears != null && (
              <span className="text-ink-500"> · {a.lockYears} an{a.lockYears > 1 ? 's' : ''}</span>
            )}
          </div>
        )}
      </div>

      <div className="text-[11px] text-ink-500 mt-3 font-mono leading-relaxed">
        <div>
          ouvert {formatDate(a.openingDate)} ·{' '}
          <span className="private">{formatAmount(opening, a.currency)}</span>
        </div>
        {hasMovement ? (
          <div className={delta > 0 ? 'text-sage-400 mt-0.5' : 'text-clay-300 mt-0.5'}>
            <span className="private">
              {delta > 0 ? '+' : ''}
              {formatAmount(delta, a.currency)}
            </span>{' '}
            {rangeSuffix}
          </div>
        ) : (
          <div className="text-ink-600 mt-0.5 not-italic">aucun mouvement {rangeSuffix}</div>
        )}
      </div>

      <div className="text-[11px] text-ink-500 mt-3 pt-3 border-t border-ink-800/60 flex items-baseline justify-between gap-2">
        <Link
          to={`/transactions?accountId=${a.id}`}
          className="text-ink-400 hover:text-ink-100 transition"
        >
          <span className="font-mono">{total}</span> transaction{total > 1 ? 's' : ''}
          {' '}<span className="text-ink-600">→</span>
        </Link>
        {excluded > 0 && (
          <span
            className="text-amber-300/80"
            title={`${excluded} transaction(s) datée(s) avant la date d'ouverture, exclue(s) du calcul.`}
          >
            <span className="font-mono">{excluded}</span> hors période
          </span>
        )}
      </div>
    </div>
  );
}
