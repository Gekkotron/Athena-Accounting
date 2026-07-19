import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Category, RecurringSeries } from '../../api/types';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/StateBlocks';
import { amountSignClass, formatAmount } from '../../lib/format';
import { resolveCategoryColor } from '../../lib/categories';

// UTC-safe ISO day math — matches the backend and the demo handler.
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number) as [number, number, number];
  const [yb, mb, dbn] = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(yb, mb - 1, dbn) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// Localised French day header. Today/tomorrow get named labels; everything
// else formats as "vendredi 24 juillet" (weekday day month, no year — the
// horizon is capped at 30 days so year is unambiguous).
function dayHeader(iso: string, today: string): string {
  const delta = daysBetween(today, iso);
  if (delta === 0) return "Aujourd'hui";
  if (delta === 1) return 'Demain';
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(dt);
}

interface LateEntry {
  series: RecurringSeries;
  daysLate: number;
}

export function UpcomingTab(): JSX.Element {
  const seriesQ = useQuery({
    queryKey: ['recurring', { upcoming: 30 }],
    queryFn: () => api<{ recurring: RecurringSeries[] }>('/api/recurring', { query: { upcoming: 30 } }),
  });
  const catQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });

  const catsById = useMemo(() => {
    const m = new Map<number, Category>();
    for (const c of catQ.data?.categories ?? []) m.set(c.id, c);
    return m;
  }, [catQ.data]);

  const today = todayIso();

  const { lateRows, futureByDay } = useMemo(() => {
    const rows = (seriesQ.data?.recurring ?? []).filter((r) => r.status !== 'dismissed');
    const late: LateEntry[] = [];
    const future = new Map<string, RecurringSeries[]>();

    for (const r of rows) {
      const expected = addDaysIso(r.lastSeenAt, r.cadenceDays);
      const daysLate = daysBetween(expected, today);
      const tolerance = r.cadenceDays * 0.2;
      if (daysLate > tolerance) {
        late.push({ series: r, daysLate });
        continue;
      }
      const list = future.get(r.nextDueAt) ?? [];
      list.push(r);
      future.set(r.nextDueAt, list);
    }

    // Late entries: most-late first.
    late.sort((a, b) => b.daysLate - a.daysLate);

    // Chronological day buckets.
    const sortedDays = [...future.entries()].sort(([a], [b]) => a.localeCompare(b));
    return { lateRows: late, futureByDay: sortedDays };
  }, [seriesQ.data, today]);

  if (seriesQ.isLoading || catQ.isLoading) return <LoadingBlock />;
  if (seriesQ.error) {
    return <ErrorState error={seriesQ.error} onRetry={() => void seriesQ.refetch()} />;
  }

  if (lateRows.length === 0 && futureByDay.length === 0) {
    return (
      <EmptyState
        title="Aucune échéance récurrente prévue dans les 30 prochains jours."
        hint={
          <span>
            Confirmez d'abord vos séries récurrentes depuis l'onglet{' '}
            <Link to="/recurrent/detectes" className="text-sage-300 underline-offset-2 hover:underline">
              Détectés
            </Link>
            .
          </span>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {lateRows.length > 0 && (
        <section className="surface p-4 md:p-5 border-clay-800/60">
          <header className="display text-base text-clay-200 pb-3 mb-3 border-b border-clay-900/40">
            En retard
          </header>
          <ul className="flex flex-col gap-1">
            {lateRows.map(({ series, daysLate }) => (
              <UpcomingRow
                key={series.id}
                row={series}
                cat={series.categoryId != null ? catsById.get(series.categoryId) ?? null : null}
                lateDays={Math.ceil(daysLate)}
              />
            ))}
          </ul>
        </section>
      )}

      {futureByDay.map(([iso, rows]) => (
        <section key={iso} className="surface p-4 md:p-5">
          <header className="display text-base text-ink-100 capitalize pb-3 mb-3 border-b border-ink-800/70">
            {dayHeader(iso, today)}
          </header>
          <ul className="flex flex-col gap-1">
            {rows.map((row) => (
              <UpcomingRow
                key={row.id}
                row={row}
                cat={row.categoryId != null ? catsById.get(row.categoryId) ?? null : null}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function UpcomingRow({
  row,
  cat,
  lateDays,
}: {
  row: RecurringSeries;
  cat: Category | null;
  lateDays?: number;
}): JSX.Element {
  return (
    <li className="flex flex-wrap items-center gap-3 py-2 px-1 border-b border-ink-900/50 last:border-b-0">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {cat && (
          <span
            className="h-2 w-2 rounded-full border border-ink-700 shrink-0"
            style={{ backgroundColor: resolveCategoryColor(cat) }}
            aria-hidden
          />
        )}
        <span className="text-sm text-ink-100 truncate">{row.label}</span>
        <span
          className={`text-[10px] uppercase tracking-wider rounded-full px-1.5 py-[1px] border shrink-0 ${
            row.status === 'confirmed'
              ? 'text-sage-300/80 border-sage-800/60'
              : 'text-ink-400 border-ink-700/70'
          }`}
        >
          {row.status === 'confirmed' ? 'Confirmé' : 'Détecté'}
        </span>
        {row.essentialness === 'essential' && (
          <span className="text-[10px] uppercase tracking-wider rounded-full px-1.5 py-[1px] border border-sage-800/60 text-sage-300/80 shrink-0">
            Essentiel
          </span>
        )}
        {lateDays !== undefined && (
          <span className="text-[10px] uppercase tracking-wider rounded-full px-1.5 py-[1px] border border-clay-700/70 text-clay-200 shrink-0">
            Retard : {lateDays} jours
          </span>
        )}
      </div>
      {cat && <span className="text-xs text-ink-500 shrink-0">{cat.name}</span>}
      <span className={`text-sm tabular-nums shrink-0 ${amountSignClass(row.avgAmount)}`}>
        {formatAmount(row.avgAmount)}
      </span>
    </li>
  );
}
