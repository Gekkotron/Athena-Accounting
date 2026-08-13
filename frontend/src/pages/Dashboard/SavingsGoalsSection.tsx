import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listGoals } from '../../api/goals';
import { ErrorState, LoadingBlock } from '../../components/StateBlocks';
import { GoalCard } from '../Goals/GoalCard';
import { sortBySoonest } from '../Goals/goal-math';

// Compact Dashboard section: up to 3 goals sorted by soonest deadline (nulls
// last), tie-break on lowest rawPct so the more urgent goal wins. Renders
// nothing when the user has no goals — the CTA lives on the Goals page + on
// each AccountCard, so we don't muddy the Dashboard with empty-state prompts.
export function SavingsGoalsSection() {
  const { t } = useTranslation('goals');
  const q = useQuery({
    queryKey: ['goals', false],
    queryFn: () => listGoals(false),
  });

  if (q.isError) {
    return (
      <section>
        <div className="section-rule mb-3">{t('dashboard.sectionTitle')}</div>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} variant="inline" />
      </section>
    );
  }
  if (q.isLoading) return <LoadingBlock />;
  const all = q.data?.goals ?? [];
  if (all.length === 0) return null;
  const top = all.slice().sort(sortBySoonest).slice(0, 3);

  return (
    <section>
      <div className="section-rule mb-3 flex items-baseline justify-between">
        <span>{t('dashboard.sectionTitle')}</span>
        <Link to="/goals" className="text-[11px] text-ink-500 hover:text-ink-100">
          {t('dashboard.viewAll', { count: all.length })}
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {top.map((g) => (
          <Link key={g.id} to={`/goals?highlight=${g.id}`} className="block">
            <GoalCard goal={g} onOpen={() => {}} />
          </Link>
        ))}
      </div>
    </section>
  );
}
