import { useState } from 'react';
import type { BudgetReport, BudgetPeriod } from '../../api/types';
import { formatAmount } from '../../lib/format';

export function UnbudgetedSection(props: {
  candidates: BudgetReport['unbudgetedCandidates'];
  period: BudgetPeriod;
  onDefineBudget: (categoryId: number, suggestedLimit: string) => void;
}): JSX.Element | null {
  const { candidates, period, onDefineBudget } = props;
  const [open, setOpen] = useState(false);
  if (candidates.length === 0) return null;
  const suffix = period === 'monthly' ? '/mois' : '/an';
  return (
    <div className="surface p-4 flex flex-col gap-3">
      <button
        type="button"
        className="flex items-center justify-between text-sm text-ink-300"
        onClick={() => setOpen(!open)}
      >
        <span>Catégories sans budget ({candidates.length})</span>
        <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ul className="flex flex-col gap-2 text-sm">
          {candidates.map((c) => (
            <li key={c.categoryId} className="flex items-center justify-between">
              <span>
                {c.name}{' '}
                <span className="text-ink-500 text-xs">
                  ({formatAmount(c.average)}{suffix})
                </span>
              </span>
              <button
                type="button"
                className="btn-ghost !py-1 !px-2 text-xs"
                onClick={() => onDefineBudget(c.categoryId, c.average)}
              >Définir un plafond</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
