import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { SavingsGoal } from '../../api/types';
import { listGoals } from '../../api/goals';
import { formatAmount } from '../../lib/format';
import { colorBand } from '../Goals/goal-math';

const BAND_BAR: Record<'green' | 'amber' | 'red', string> = {
  green: 'bg-sage-500',
  amber: 'bg-amber-500',
  red: 'bg-clay-500',
};

// Compact "Objectifs" strip shown inside an AccountCard. One row per
// non-closed goal on this account, each row a deep-link to /goals?highlight=…
// The "+ Ajouter" chip opens the Goals page's create modal via a
// URL search-param (?create=1); on the Goals page, `create=1` triggers the
// modal open on mount so the user doesn't lose the Comptes context beyond a
// single navigation.
export function AccountCardGoals({ accountId, currency }: { accountId: number; currency: string }) {
  const { t } = useTranslation('goals');
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['goals', false],
    queryFn: () => listGoals(false),
  });
  const goals: SavingsGoal[] = (q.data?.goals ?? []).filter((g) => g.accountId === accountId);
  if (q.isLoading) return null;

  return (
    <div className="mt-3 pt-3 border-t border-ink-800/60">
      <div className="flex items-baseline justify-between mb-2">
        <div className="label">{t('accountCard.sectionTitle')}</div>
        <button
          type="button"
          onClick={() => navigate(`/goals?create=1&accountId=${accountId}`)}
          className="text-[11px] text-ink-500 hover:text-ink-100 transition"
        >
          {t('accountCard.addChip')}
        </button>
      </div>
      {goals.length === 0 && (
        <div className="text-[11px] text-ink-600">{t('empty.title')}</div>
      )}
      <ul className="space-y-1.5">
        {goals.map((g) => {
          const band = colorBand(g.rawPct);
          const bar = Math.min(100, Math.max(0, g.progressPct));
          return (
            <li key={g.id}>
              <Link
                to={`/goals?highlight=${g.id}`}
                className="block rounded-md hover:bg-ink-900 -mx-1 px-1 py-1"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-[11px] text-ink-200 truncate">{g.name}</div>
                  <div className="text-[10px] text-ink-500 shrink-0 tabular-nums">
                    <span className="private">
                      {formatAmount(g.savedAmount, currency)} / {formatAmount(g.targetAmount, currency)}
                    </span>
                  </div>
                </div>
                <div className="mt-1 h-1 rounded-full bg-ink-900 overflow-hidden">
                  <div className={`h-full ${BAND_BAR[band]}`} style={{ width: `${bar}%` }} />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
