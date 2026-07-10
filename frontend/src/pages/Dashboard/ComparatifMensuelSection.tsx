import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Category, CategoryReportRow } from '../../api/types';
import { formatAmount } from '../../lib/format';
import { Sparkline } from '../../components/Sparkline';
import {
  buildComparison,
  recentMonthKeys,
  currentMonthKey,
  deltaTone,
  type ComparatifMode,
} from './helpers';

const WINDOW_MONTHS = 6;

// French lower-case month names for the header, indexed 0..11.
const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

function monthLabel(key: string): string {
  const [, m] = key.split('-');
  return MONTH_NAMES[Number(m) - 1] ?? key;
}

const TONE_CLASS: Record<'sage' | 'clay' | 'neutral', string> = {
  sage: 'text-sage-300',
  clay: 'text-clay-300',
  neutral: 'text-ink-400',
};

function formatDeltaAmount(deltaAbs: number, currency: string): string {
  const sign = deltaAbs > 0 ? '+' : '';
  return `${sign}${formatAmount(deltaAbs, currency)}`;
}

function formatPct(deltaPct: number | null): string {
  if (deltaPct === null) return 'nouveau';
  const sign = deltaPct > 0 ? '+' : '';
  return `${sign}${deltaPct.toFixed(1).replace('.', ',')} %`;
}

interface Props {
  currency: string;
  accountId?: number | 'all';
}

export function ComparatifMensuelSection({ currency, accountId }: Props): JSX.Element | null {
  const [mode, setMode] = useState<ComparatifMode>('expense');
  const scopedAccountId = typeof accountId === 'number' ? accountId : undefined;

  const months = useMemo(() => recentMonthKeys(WINDOW_MONTHS), []);
  const currentMonth = useMemo(() => currentMonthKey(), []);
  const fromDate = `${months[0]}-01`;

  const reportQ = useQuery({
    queryKey: ['reports', 'categories', { fromDate, accountId: scopedAccountId ?? 'all' }],
    queryFn: () =>
      api<{ rows: CategoryReportRow[] }>('/api/reports/categories', {
        query: {
          fromDate,
          ...(scopedAccountId ? { accountId: scopedAccountId } : {}),
        },
      }),
  });
  const categoriesQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });

  const rows = useMemo(() => {
    const built = buildComparison(reportQ.data?.rows ?? [], mode, currentMonth, months);
    const byId = new Map((categoriesQ.data?.categories ?? []).map((c) => [c.id, c] as const));
    // Fill category colors from /api/categories (report rows carry none).
    return built.map((r) => ({
      ...r,
      color: r.id !== null ? byId.get(r.id)?.color ?? null : null,
    }));
  }, [reportQ.data, categoriesQ.data, mode, currentMonth, months]);

  if (reportQ.isLoading) {
    return (
      <section>
        <div className="section-rule mb-4">Comparatif mensuel</div>
        <div className="h-40 animate-pulse rounded-lg bg-ink-900" />
      </section>
    );
  }

  const prevMonth = months[months.indexOf(currentMonth) - 1] ?? months[months.length - 2];

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="section-rule">
          Comparatif mensuel{' '}
          <span className="text-ink-500 font-normal text-xs normal-case tracking-normal">
            — {monthLabel(currentMonth)} vs {monthLabel(prevMonth)} · mois en cours
          </span>
        </div>
        <div className="inline-flex rounded-lg border border-ink-800 bg-ink-900/60 p-0.5 text-xs">
          <button
            onClick={() => setMode('expense')}
            className={`px-3 py-1.5 rounded-md transition ${
              mode === 'expense' ? 'bg-ink-850 text-ink-100' : 'text-ink-400 hover:text-ink-100'
            }`}
          >
            Dépenses
          </button>
          <button
            onClick={() => setMode('income')}
            className={`px-3 py-1.5 rounded-md transition ${
              mode === 'income' ? 'bg-ink-850 text-ink-100' : 'text-ink-400 hover:text-ink-100'
            }`}
          >
            Revenus
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="surface p-5 text-sm text-ink-400 display-italic">
          Pas encore d'historique pour cette période.
        </div>
      ) : (
        <div className="surface divide-y divide-ink-850">
          {rows.map((r) => {
            const tone = TONE_CLASS[deltaTone(mode, r.deltaAbs)];
            return (
              <div
                key={r.id ?? 'uncat'}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[1.4fr_repeat(3,1fr)_auto]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: r.color ?? '#6b7280' }}
                  />
                  <span className="truncate text-ink-100">{r.name}</span>
                </div>
                <div className="text-right tabular-nums text-ink-100">
                  {formatAmount(r.current, currency)}
                </div>
                <div className="hidden text-right tabular-nums text-ink-400 sm:block">
                  {formatAmount(r.previous, currency)}
                </div>
                <div className={`text-right tabular-nums ${tone}`}>
                  <div>{formatDeltaAmount(r.deltaAbs, currency)}</div>
                  <div className="text-xs">{formatPct(r.deltaPct)}</div>
                </div>
                <div className="hidden justify-self-end sm:block">
                  <Sparkline values={r.spark} color={r.color} aria-label={`tendance ${r.name}`} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
