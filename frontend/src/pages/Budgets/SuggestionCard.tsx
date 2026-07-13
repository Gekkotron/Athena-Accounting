import { useState } from 'react';
import type { BudgetReportRow } from '../../api/types';
import { formatAmount } from '../../lib/format';

const KEY_PREFIX = 'budget-suggestions-dismissed-';

function loadDismissed(periodKey: string): number[] {
  try { return JSON.parse(localStorage.getItem(KEY_PREFIX + periodKey) ?? '[]'); }
  catch { return []; }
}

function saveDismissed(periodKey: string, list: number[]): void {
  localStorage.setItem(KEY_PREFIX + periodKey, JSON.stringify(list));
}

export function SuggestionCard(props: {
  row: BudgetReportRow;
  budgetId: number;
  periodKey: string;
  onApply: (id: number, newLimit: string) => void;
}): JSX.Element | null {
  const { row, budgetId, periodKey, onApply } = props;
  const [dismissedNow, setDismissedNow] = useState(false);

  if (row.suggestedLimit == null) return null;
  const dismissedList = loadDismissed(periodKey);
  if (dismissedNow || dismissedList.includes(row.categoryId)) return null;

  const chronicUnder = Number(row.suggestedLimit) < Number(row.limit);
  const copy = chronicUnder
    ? `${row.name} est sous le plafond depuis 3 mois. Passer à ${formatAmount(row.suggestedLimit, row.currency)} ?`
    : `${row.name} dépasse depuis 3 mois. Passer à ${formatAmount(row.suggestedLimit, row.currency)} ?`;

  const dismiss = () => {
    setDismissedNow(true);
    saveDismissed(periodKey, [...dismissedList, row.categoryId]);
  };

  return (
    <li className="surface p-3 flex items-center justify-between text-sm border border-ink-800 bg-ink-900/50">
      <span className="text-ink-300">{copy}</span>
      <span className="flex items-center gap-2">
        <button type="button" className="btn-ghost !py-1 !px-2 text-xs" onClick={dismiss}>Ignorer</button>
        <button
          type="button"
          className="btn-primary !py-1 !px-3 text-xs"
          onClick={() => onApply(budgetId, row.suggestedLimit!)}
        >Ajuster à {formatAmount(row.suggestedLimit, row.currency)}</button>
      </span>
    </li>
  );
}
