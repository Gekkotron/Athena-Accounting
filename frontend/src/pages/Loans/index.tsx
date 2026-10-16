import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { listLoans } from '../../api/loans';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/StateBlocks';
import { LoanCard } from './LoanCard';
import { LoanDrawer } from './LoanDrawer';
import { sortLoans, type LoansTab } from './loan-list';

const TABS: LoansTab[] = ['loans', 'simulations'];

export function Loans() {
  const { t } = useTranslation('loans');
  const [params, setParams] = useSearchParams();
  const tab: LoansTab = params.get('tab') === 'simulations' ? 'simulations' : 'loans';
  const [openId, setOpenId] = useState<number | null>(null);
  const q = useQuery({ queryKey: ['loans', 'list'], queryFn: listLoans });
  const shown = sortLoans(q.data?.loans ?? [], tab);

  const selectTab = (next: LoansTab) => {
    if (next === 'simulations') params.set('tab', 'simulations');
    else params.delete('tab');
    setParams(params, { replace: true });
  };

  return (
    <div className="max-w-5xl mx-auto p-4">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-2xl">{t('title')}</h1>
          <p className="text-sm text-ink-500 mt-1 max-w-xl">{t('subtitle')}</p>
        </div>
      </header>

      <div role="tablist" aria-label={t('title')} className="mb-4 flex gap-1">
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => selectTab(k)}
            className={`px-3 py-1.5 text-xs rounded ${tab === k ? 'bg-ink-800 text-ink-100' : 'text-ink-500 hover:text-ink-100'}`}
          >
            {t(`tabs.${k}`)}
          </button>
        ))}
      </div>

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <LoadingBlock />
      ) : shown.length === 0 ? (
        <EmptyState title={t(`empty.${tab}.title`)} hint={t(`empty.${tab}.hint`)} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((l) => (
            <LoanCard key={l.id} loan={l} onOpen={setOpenId} />
          ))}
        </div>
      )}
      {openId !== null && <LoanDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
