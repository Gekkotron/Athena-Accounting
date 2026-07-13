import { useState } from 'react';
import type { BudgetReportRow } from '../../api/types';
import { formatAmount } from '../../lib/format';
import { Sparkline } from './Sparkline';

function barColor(pct: number, over: boolean): string {
  if (over) return 'bg-clay-500';
  if (pct >= 80) return 'bg-amber-500';
  return 'bg-sage-500';
}

function isValidLimit(v: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0;
}

function paceState(row: BudgetReportRow): 'over' | 'onTrack' | 'unknown' {
  if (row.projected == null) return 'unknown';
  return Number(row.projected) > Number(row.limit) ? 'over' : 'onTrack';
}

export function BudgetRow(props: {
  row: BudgetReportRow;
  depth: 0 | 1;
  budgetId: number | undefined;
  onSave: (id: number, limit: string) => void;
  onDelete: (id: number) => void;
}): JSX.Element {
  const { row: r, depth, budgetId, onSave, onDelete } = props;
  const pct = Math.min(Math.max(r.pct, 0), 100);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(r.limit);
  const state = paceState(r);
  const historyValues = r.history?.values ?? [];
  const sparkValues = [...historyValues, r.spent];  // append current bar

  return (
    <li
      data-role="budget-row"
      data-depth={depth}
      className={`surface p-4 ${depth === 1 ? 'ml-8 bg-ink-900/20' : ''}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">{r.name}</span>
          {r.anomaly && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-ink-800 text-ink-300 border border-ink-700">
              ● anomalie
            </span>
          )}
        </div>
        <span className="text-sm tabular-nums private">
          {formatAmount(r.spent, r.currency)} / {Number(r.limit) > 0 ? formatAmount(r.limit, r.currency) : '—'}
        </span>
      </div>

      <div className="flex items-center justify-between text-xs text-ink-400 mb-2">
        <Sparkline values={sparkValues} state={state} />
        <span className="tabular-nums">
          {r.projected != null ? `~${formatAmount(r.projected, r.currency)}` : '—'}
          {r.history && (
            <span className="ml-2 text-ink-500">
              · avg {formatAmount(r.history.average, r.currency)}
            </span>
          )}
        </span>
      </div>

      <div className="h-2.5 rounded-full bg-ink-800 overflow-hidden relative">
        <div className={`h-full ${barColor(r.pct, r.over)}`} style={{ width: `${pct}%` }} />
        <span
          className="absolute inset-0 flex items-center justify-end pr-1 text-[10px] tabular-nums text-ink-100"
          aria-hidden="true"
        >{r.pct}%</span>
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
        {budgetId !== undefined && (editing ? (
          <span className="flex items-center gap-1">
            <input
              className="input w-24 !py-1" type="number" min="0" step="0.01"
              aria-label="Modifier le plafond"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            {r.suggestedLimit && (
              <span className="text-[10px] text-ink-500">
                Suggéré : {formatAmount(r.suggestedLimit, r.currency)}
              </span>
            )}
            <button
              className="btn-ghost !py-1 !px-2 text-xs"
              onClick={() => {
                if (isValidLimit(value)) { onSave(budgetId, value); setEditing(false); }
              }}
            >OK</button>
            <button
              className="btn-ghost !py-1 !px-2 text-xs"
              onClick={() => { setValue(r.limit); setEditing(false); }}
            >Annuler</button>
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => setEditing(true)}>Modifier</button>
            <button className="btn-ghost !py-1 !px-2 text-xs text-clay-300" onClick={() => onDelete(budgetId)}>Supprimer</button>
          </span>
        ))}
      </div>
    </li>
  );
}
