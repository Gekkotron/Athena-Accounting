import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type {
  Category,
  RecurringEssentialness,
  RecurringSeries,
  RecurringStatus,
} from '../../api/types';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/StateBlocks';
import { amountSignClass, formatAmount, formatDate } from '../../lib/format';
import { resolveCategoryColor } from '../../lib/categories';
import { cadenceLabel, monthlyEquivalent, monthlyEquivalentTotal } from './lib';
import { useAutoStartTour } from '../../hooks/useAutoStartTour';
import { useTourAnchor } from '../../hooks/useTourAnchor';
import { TourReplayIcon } from '../../components/TourReplayIcon';

interface UpdatePatch {
  status?: RecurringStatus;
  essentialness?: RecurringEssentialness | null;
}

export function DetectedTab(): JSX.Element {
  const qc = useQueryClient();

  const seriesQ = useQuery({
    queryKey: ['recurring'],
    queryFn: () => api<{ recurring: RecurringSeries[] }>('/api/recurring'),
  });
  const catQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: UpdatePatch }) =>
      api(`/api/recurring/${id}`, { method: 'PUT', json: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring'] }),
  });

  const regenerate = useMutation({
    mutationFn: () => api('/api/recurring/regenerate', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring'] }),
  });

  const catsById = useMemo(() => {
    const m = new Map<number, Category>();
    for (const c of catQ.data?.categories ?? []) m.set(c.id, c);
    return m;
  }, [catQ.data]);

  const grouped = useMemo(() => {
    const active = (seriesQ.data?.recurring ?? []).filter((s) => s.status !== 'dismissed');
    const byCat = new Map<number | null, RecurringSeries[]>();
    for (const s of active) {
      const key = s.categoryId ?? null;
      const list = byCat.get(key) ?? [];
      list.push(s);
      byCat.set(key, list);
    }
    // Sort each group by monthly-equivalent magnitude descending so the
    // biggest series lead each category.
    for (const list of byCat.values()) {
      list.sort((a, b) => Math.abs(monthlyEquivalent(b)) - Math.abs(monthlyEquivalent(a)));
    }
    // Sort groups themselves by |monthly-equivalent total| descending. "Sans
    // catégorie" always drops to the bottom, regardless of magnitude.
    return [...byCat.entries()]
      .sort(([, aList], [, bList]) => {
        return Math.abs(monthlyEquivalentTotal(bList)) - Math.abs(monthlyEquivalentTotal(aList));
      })
      .sort(([a], [b]) => {
        if (a === null && b !== null) return 1;
        if (b === null && a !== null) return -1;
        return 0;
      });
  }, [seriesQ.data]);

  const dismissed = useMemo(
    () => (seriesQ.data?.recurring ?? []).filter((s) => s.status === 'dismissed'),
    [seriesQ.data],
  );

  useAutoStartTour('recurring-detected');
  const listAnchor = useTourAnchor('recurring-detected:list');
  const confirmAnchor = useTourAnchor('recurring-detected:confirm');

  if (seriesQ.isLoading || catQ.isLoading) return <LoadingBlock />;
  if (seriesQ.error) {
    return <ErrorState error={seriesQ.error} onRetry={() => void seriesQ.refetch()} />;
  }

  const rows = seriesQ.data?.recurring ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Aucune série récurrente détectée pour l'instant."
        hint="Athena repère automatiquement les prélèvements réguliers après chaque import. Lancez une détection manuelle si vous avez déjà des transactions."
        action={
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => regenerate.mutate()}
            disabled={regenerate.isPending}
          >
            {regenerate.isPending ? 'Détection…' : 'Régénérer la détection'}
          </button>
        }
      />
    );
  }

  return (
    <div className="relative flex flex-col gap-6">
      <span ref={listAnchor} aria-hidden className="pointer-events-none absolute right-4 top-4 h-1 w-1" />
      <span ref={confirmAnchor} aria-hidden className="pointer-events-none absolute right-16 top-4 h-1 w-1" />
      <div className="flex justify-end">
        <TourReplayIcon pageId="recurring-detected" />
      </div>
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-400 max-w-2xl">
          Séries récurrentes détectées dans vos transactions des 12 derniers mois. Confirmez celles qui correspondent à un vrai abonnement, ignorez le reste.
        </p>
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => regenerate.mutate()}
          disabled={regenerate.isPending}
        >
          {regenerate.isPending ? 'Détection…' : 'Régénérer'}
        </button>
      </div>

      {grouped.map(([categoryId, groupRows]) => {
        const cat = categoryId != null ? catsById.get(categoryId) : null;
        const total = monthlyEquivalentTotal(groupRows);
        const groupKey = categoryId == null ? 'uncategorized' : String(categoryId);
        return (
          <section key={groupKey} className="surface p-4 md:p-5">
            <header className="flex items-center gap-3 pb-3 mb-3 border-b border-ink-800/70">
              {cat ? (
                <span
                  className="h-2.5 w-2.5 rounded-full border border-ink-700 shrink-0"
                  style={{ backgroundColor: resolveCategoryColor(cat) }}
                  aria-hidden
                />
              ) : (
                <span className="h-2.5 w-2.5 rounded-full border border-ink-700 bg-ink-800 shrink-0" aria-hidden />
              )}
              <span className="display text-base text-ink-100">
                {cat ? cat.name : 'Sans catégorie'}
              </span>
              <span className="text-xs text-ink-500 ml-auto">
                Équivalent mensuel :{' '}
                <span className={amountSignClass(total)}>{formatAmount(total)}</span>
              </span>
            </header>
            <ul className="flex flex-col gap-2">
              {groupRows.map((row) => (
                <SeriesRow key={row.id} row={row} onUpdate={(patch) => update.mutate({ id: row.id, patch })} />
              ))}
            </ul>
          </section>
        );
      })}

      {dismissed.length > 0 && (
        <section className="surface-soft p-4">
          <details>
            <summary className="cursor-pointer text-sm text-ink-400">
              {dismissed.length} série{dismissed.length > 1 ? 's' : ''} ignorée{dismissed.length > 1 ? 's' : ''}
            </summary>
            <ul className="flex flex-col gap-1 mt-3">
              {dismissed.map((row) => (
                <li key={row.id} className="flex items-center gap-3 text-sm text-ink-500">
                  <span className="truncate flex-1">{row.label}</span>
                  <span className="text-xs text-ink-600">{cadenceLabel(row.cadenceDays)}</span>
                  <button
                    type="button"
                    className="text-xs text-sage-300 hover:text-sage-200 underline-offset-2 hover:underline"
                    onClick={() => update.mutate({ id: row.id, patch: { status: 'detected' } })}
                  >
                    Annuler
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </div>
  );
}

function SeriesRow({
  row,
  onUpdate,
}: {
  row: RecurringSeries;
  onUpdate: (patch: UpdatePatch) => void;
}): JSX.Element {
  const isConfirmed = row.status === 'confirmed';
  const essentialness = row.essentialness;

  const cycleEssentialness = () => {
    if (essentialness === 'essential') onUpdate({ essentialness: 'discretionary' });
    else if (essentialness === 'discretionary') onUpdate({ essentialness: null });
    else onUpdate({ essentialness: 'essential' });
  };

  const essentialnessLabel =
    essentialness === 'essential'
      ? 'Essentiel'
      : essentialness === 'discretionary'
        ? 'Discrétionnaire'
        : 'Marquer';
  const essentialnessTitle =
    essentialness === 'essential'
      ? 'Marqué comme essentiel. Cliquer pour passer en discrétionnaire.'
      : essentialness === 'discretionary'
        ? 'Marqué comme discrétionnaire. Cliquer pour retirer.'
        : "Marquer cette série comme essentielle.";

  return (
    <li className="flex flex-wrap items-center gap-3 py-2 px-1 border-b border-ink-900/50 last:border-b-0">
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-ink-100 truncate">{row.label}</span>
          {isConfirmed && (
            <span className="text-[10px] uppercase tracking-wider text-sage-300/80 border border-sage-800/60 rounded-full px-1.5 py-[1px]">
              Confirmé
            </span>
          )}
        </div>
        <div className="text-xs text-ink-500 flex flex-wrap gap-x-3 mt-0.5">
          <span>{cadenceLabel(row.cadenceDays)}</span>
          <span>Prochain le {formatDate(row.nextDueAt)}</span>
          <span>{row.memberCount} occurrences</span>
        </div>
      </div>
      <div className={`text-sm tabular-nums shrink-0 ${amountSignClass(row.avgAmount)}`}>
        {formatAmount(row.avgAmount)}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {!isConfirmed && (
          <button
            type="button"
            className="btn-secondary !min-h-0 !py-1 !px-2 text-xs"
            onClick={() => onUpdate({ status: 'confirmed' })}
          >
            Confirmer
          </button>
        )}
        <button
          type="button"
          className="btn-ghost !min-h-0 !py-1 !px-2 text-xs"
          onClick={() => onUpdate({ status: 'dismissed' })}
        >
          Ignorer
        </button>
        <button
          type="button"
          className={`btn-ghost !min-h-0 !py-1 !px-2 text-xs ${
            essentialness ? 'text-sage-300' : 'text-ink-500'
          }`}
          title={essentialnessTitle}
          onClick={cycleEssentialness}
        >
          {essentialnessLabel}
        </button>
      </div>
    </li>
  );
}
