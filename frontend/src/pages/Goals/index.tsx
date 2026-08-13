import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Account } from '../../api/types';
import { createGoal, listGoals } from '../../api/goals';
import { formatAmount } from '../../lib/format';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/StateBlocks';
import type { SavingsGoal } from '../../api/types';
import { GoalCard } from './GoalCard';
import { GoalForm } from './GoalForm';
import { GoalDetailDrawer } from './GoalDetailDrawer';

// Full goals page. Layout is a stack of per-account sections (name + currency +
// reserved-vs-available strip), each with a grid of GoalCards. Clicking a card
// opens the detail drawer inline below the card. `?highlight=<id>` scrolls the
// card into view and ring-highlights it (deep-link from AccountCard strip).
export function Goals() {
  const { t } = useTranslation('goals');
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightRaw = searchParams.get('highlight');
  const highlightId = highlightRaw ? Number(highlightRaw) : null;
  const createFromParam = searchParams.get('create') === '1';
  const preselectedAccountIdRaw = searchParams.get('accountId');
  const preselectedAccountId = preselectedAccountIdRaw ? Number(preselectedAccountIdRaw) : null;
  const [includeClosed, setIncludeClosed] = useState(false);
  const [creating, setCreating] = useState(createFromParam);
  const [openId, setOpenId] = useState<number | null>(null);
  const [reachedToast, setReachedToast] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const goalsQ = useQuery({
    queryKey: ['goals', includeClosed],
    queryFn: () => listGoals(includeClosed),
  });

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });

  const createMut = useMutation({
    mutationFn: (v: {
      accountId: number; name: string; targetAmount: string;
      targetDate: string | null; color: string | null;
    }) => createGoal(v),
    onSuccess: () => {
      setCreating(false); setFormError(null);
      qc.invalidateQueries({ queryKey: ['goals'] });
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : String(err)),
  });

  const highlightRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!highlightId || !goalsQ.data) return;
    const t = setTimeout(() => {
      highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    return () => clearTimeout(t);
  }, [highlightId, goalsQ.data]);

  const goals = goalsQ.data?.goals;
  const goalsByAccount = useMemo(() => {
    const m = new Map<number, SavingsGoal[]>();
    for (const g of goals ?? []) {
      const arr = m.get(g.accountId) ?? [];
      arr.push(g);
      m.set(g.accountId, arr);
    }
    return m;
  }, [goals]);

  const accounts = accountsQ.data?.accounts ?? [];
  const perAccount = goalsQ.data?.perAccount ?? {};

  return (
    <div className="max-w-5xl mx-auto p-4">
      <div className="flex items-baseline justify-between gap-4 mb-4">
        <div>
          <h1 className="display text-2xl">{t('title')}</h1>
          <p className="text-sm text-ink-500 mt-1 max-w-xl">{t('subtitle')}</p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          {t('addButton')}
        </button>
      </div>

      <div className="mb-4">
        <label className="inline-flex items-center gap-2 text-xs text-ink-400">
          <input
            type="checkbox"
            checked={includeClosed}
            onChange={(e) => setIncludeClosed(e.target.checked)}
          />
          {t('filters.showClosed')}
        </label>
      </div>

      {goalsQ.isError ? (
        <ErrorState error={goalsQ.error} onRetry={() => void goalsQ.refetch()} />
      ) : goalsQ.isLoading ? (
        <LoadingBlock />
      ) : (goalsQ.data?.goals ?? []).length === 0 ? (
        <EmptyState title={t('empty.title')} hint={t('empty.hint')} />
      ) : (
        accounts.map((a) => {
          const list = goalsByAccount.get(a.id);
          if (!list || list.length === 0) return null;
          const balance = Number(a.currentBalance ?? '0');
          const savedSum = Number(perAccount[a.id]?.savedSum ?? '0');
          const overReserved = savedSum > balance + 0.005;
          return (
            <section key={a.id} className="mb-6">
              <header className="mb-3 flex items-baseline justify-between gap-3">
                <div className="text-sm font-medium text-ink-100">{a.name}</div>
                <div className={`text-[11px] font-mono tabular-nums ${overReserved ? 'text-amber-300' : 'text-ink-500'}`}>
                  <span className="private">
                    {t('sectionsHeader.reservedOf', {
                      saved: formatAmount(savedSum, a.currency),
                      balance: formatAmount(balance, a.currency),
                    })}
                  </span>
                </div>
              </header>
              {overReserved && (
                <div className="text-[11px] text-amber-300/80 mb-2" role="note">
                  {t('sectionsHeader.overReservedWarning')}
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {list.map((g) => (
                  <div key={g.id} ref={g.id === highlightId ? highlightRef : undefined}>
                    <GoalCard
                      goal={g}
                      onOpen={(id) => {
                        setOpenId(openId === id ? null : id);
                        if (highlightId) {
                          searchParams.delete('highlight');
                          setSearchParams(searchParams, { replace: true });
                        }
                      }}
                      highlighted={g.id === highlightId}
                    />
                    {openId === g.id && (
                      <div className="mt-2">
                        <GoalDetailDrawer
                          goal={g}
                          accounts={accounts}
                          onClose={() => setOpenId(null)}
                          onReached={() => {
                            setReachedToast(true);
                            setTimeout(() => setReachedToast(false), 4000);
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })
      )}

      {creating && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4"
          onClick={() => setCreating(false)}
        >
          <div
            className="surface p-4 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="display text-sm text-ink-100 mb-3">{t('form.createTitle')}</div>
            <GoalForm
              accounts={accounts}
              defaultAccountId={preselectedAccountId}
              submitting={createMut.isPending}
              serverError={formError}
              onSubmit={(v) => createMut.mutate(v)}
              onCancel={() => { setCreating(false); setFormError(null); }}
            />
          </div>
        </div>
      )}

      {reachedToast && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 surface px-4 py-2 text-sm text-sage-200 border-sage-500/40 z-50"
        >
          {t('events.toastReached')}
        </div>
      )}
    </div>
  );
}
