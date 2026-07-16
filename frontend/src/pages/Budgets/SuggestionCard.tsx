import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('budgets');
  const { row, budgetId, periodKey, onApply } = props;
  // Tracks only "I was just dismissed, for this exact period + category" —
  // not a plain boolean — because the mount site in index.tsx keeps this
  // component's key stable (`suggest-${categoryId}`) across period
  // navigation. A plain boolean would leak a July dismissal into August
  // since React reuses the same instance instead of remounting it.
  const [justDismissed, setJustDismissed] = useState<{ periodKey: string; categoryId: number } | null>(null);

  if (row.suggestedLimit == null) return null;
  const dismissedList = loadDismissed(periodKey);
  const dismissedNow = justDismissed?.periodKey === periodKey && justDismissed?.categoryId === row.categoryId;
  if (dismissedNow || dismissedList.includes(row.categoryId)) return null;

  const chronicUnder = Number(row.suggestedLimit) < Number(row.limit);
  const copy = chronicUnder
    ? t('suggestion.chronicUnder', { name: row.name, amount: formatAmount(row.suggestedLimit, row.currency) })
    : t('suggestion.chronicOver', { name: row.name, amount: formatAmount(row.suggestedLimit, row.currency) });

  const dismiss = () => {
    setJustDismissed({ periodKey, categoryId: row.categoryId });
    saveDismissed(periodKey, [...dismissedList, row.categoryId]);
  };

  return (
    <li className="surface p-3 flex items-center justify-between text-sm border border-ink-800 bg-ink-900/50">
      <span className="text-ink-300">{copy}</span>
      <span className="flex items-center gap-2">
        <button type="button" className="btn-ghost !py-1 !px-2 text-xs" onClick={dismiss}>{t('suggestion.dismiss')}</button>
        <button
          type="button"
          className="btn-primary !py-1 !px-3 text-xs"
          onClick={() => { onApply(budgetId, row.suggestedLimit!); dismiss(); }}
        >{t('suggestion.apply', { amount: formatAmount(row.suggestedLimit, row.currency) })}</button>
      </span>
    </li>
  );
}
