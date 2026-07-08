import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Category } from '../../api/types';
import { useBudgets, useBudgetReport } from '../../lib/useBudgets';
import { formatAmount } from '../../lib/format';

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Over budget is red (authoritative: server flags `over` as spent > limit, which
// survives pct rounding — e.g. 1004/1000 rounds to pct 100 but is still over).
// Otherwise amber from 80%, green below.
function barColor(pct: number, over: boolean): string {
  if (over) return 'bg-clay-500';
  if (pct >= 80) return 'bg-amber-500';
  return 'bg-sage-500';
}

function isValidLimit(v: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0;
}

const MUTATION_ERROR_FALLBACK = "Impossible d'enregistrer le budget.";

function mutationErrorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : MUTATION_ERROR_FALLBACK;
}

export function Budgets(): JSX.Element {
  const [month, setMonth] = useState(currentMonth());
  const { budgets, create, update, remove } = useBudgets();
  const report = useBudgetReport(month);
  const rows = report.data?.rows ?? [];

  const categoriesQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });
  const budgetedIds = useMemo(() => new Set(budgets.map((b) => b.categoryId)), [budgets]);
  const addable = (categoriesQ.data?.categories ?? []).filter(
    (c) => c.kind === 'expense' && !budgetedIds.has(c.id),
  );

  const [newCatId, setNewCatId] = useState('');
  const [newLimit, setNewLimit] = useState('');
  const [mutationError, setMutationError] = useState<string | null>(null);

  const submitNew = () => {
    const categoryId = Number(newCatId);
    if (!categoryId || !isValidLimit(newLimit)) return;
    setMutationError(null);
    create.mutate({ categoryId, monthlyLimit: newLimit }, {
      onSuccess: () => { setNewCatId(''); setNewLimit(''); setMutationError(null); },
      onError: (err) => setMutationError(mutationErrorMessage(err)),
    });
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="display text-2xl text-ink-50">Budgets</h1>
          <p className="text-sm text-ink-400 mt-1">
            Plafond mensuel par catégorie de dépense. Seules les catégories avec un plafond apparaissent ici.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost !py-1 !px-2" aria-label="Mois précédent" onClick={() => setMonth((m) => shiftMonth(m, -1))}>‹</button>
          <span className="text-sm tabular-nums w-20 text-center">{month}</span>
          <button className="btn-ghost !py-1 !px-2" aria-label="Mois suivant" onClick={() => setMonth((m) => shiftMonth(m, 1))}>›</button>
        </div>
      </div>

      {mutationError && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
          {mutationError}
        </div>
      )}

      {report.data && rows.length > 0 && (
        <div className="surface p-4 flex items-center justify-between text-sm">
          <span className="text-ink-400">Total ce mois-ci</span>
          <span className="tabular-nums private">
            {formatAmount(report.data.totals.spent)} / {formatAmount(report.data.totals.limit)}
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="surface p-8 text-center text-ink-400">
          <p className="mb-1">Aucun budget défini.</p>
          <p className="text-sm text-ink-500">Ajoutez un plafond à une catégorie de dépense ci-dessous.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            const pctClamped = Math.min(Math.max(r.pct, 0), 100);
            return (
              <li key={r.categoryId} className="surface p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-sm tabular-nums private">
                    {formatAmount(r.spent, r.currency)} / {formatAmount(r.limit, r.currency)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-ink-800 overflow-hidden">
                  <div className={`h-full ${barColor(r.pct, r.over)}`} style={{ width: `${pctClamped}%` }} />
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className={`text-xs ${r.over ? 'text-clay-300' : 'text-ink-400'}`}>
                    {r.over ? 'Dépassé de ' : 'Reste '}
                    <span className="private">
                      {r.over
                        ? formatAmount((-Number(r.remaining)).toFixed(2), r.currency)
                        : formatAmount(r.remaining, r.currency)}
                    </span>
                  </span>
                  <BudgetRowActions
                    id={budgets.find((b) => b.categoryId === r.categoryId)?.id}
                    currentLimit={r.limit}
                    onSave={(id, limit) => update.mutate({ id, monthlyLimit: limit }, {
                      onSuccess: () => setMutationError(null),
                      onError: (err) => setMutationError(mutationErrorMessage(err)),
                    })}
                    onDelete={(id) => remove.mutate(id, {
                      onSuccess: () => setMutationError(null),
                      onError: (err) => setMutationError(mutationErrorMessage(err)),
                    })}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="surface p-4 flex flex-col gap-3">
        <div className="label">Ajouter un budget</div>
        {addable.length === 0 ? (
          <p className="text-sm text-ink-500">Toutes vos catégories de dépense ont déjà un plafond.</p>
        ) : (
          <div className="flex items-end gap-2 flex-wrap">
            <select className="input" aria-label="Catégorie" value={newCatId} onChange={(e) => setNewCatId(e.target.value)}>
              <option value="">Choisir une catégorie…</option>
              {addable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input
              className="input w-28" type="number" min="0" step="0.01"
              aria-label="Plafond mensuel" placeholder="Plafond €"
              value={newLimit} onChange={(e) => setNewLimit(e.target.value)}
            />
            <button className="btn-primary" onClick={submitNew} disabled={create.isPending}>Ajouter</button>
          </div>
        )}
      </div>
    </div>
  );
}

function BudgetRowActions(props: {
  id: number | undefined;
  currentLimit: string;
  onSave: (id: number, limit: string) => void;
  onDelete: (id: number) => void;
}) {
  const { id, currentLimit, onSave, onDelete } = props;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentLimit);
  if (id === undefined) return null;
  if (editing) {
    return (
      <span className="flex items-center gap-1">
        <input
          className="input w-24 !py-1" type="number" min="0" step="0.01"
          aria-label="Modifier le plafond" value={value} onChange={(e) => setValue(e.target.value)}
        />
        <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => {
          if (isValidLimit(value)) { onSave(id, value); setEditing(false); }
        }}>OK</button>
        <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => { setValue(currentLimit); setEditing(false); }}>Annuler</button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => setEditing(true)}>Modifier</button>
      <button className="btn-ghost !py-1 !px-2 text-xs text-clay-300" onClick={() => onDelete(id)}>Supprimer</button>
    </span>
  );
}
