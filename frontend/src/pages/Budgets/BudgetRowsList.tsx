import type { Category, BudgetReportRow } from '../../api/types';
import { BudgetRow } from './BudgetRow';
import { SuggestionCard } from './SuggestionCard';

type LiRef = ((el: HTMLLIElement | null) => void) | undefined;

// Wraps every row-like node in a single mount-order-stable <ul>. The
// tour anchor is threaded in through `firstRowRef`, which is set on the
// caller's very first rendered node — root, header, child, or orphan —
// so BudgetRow forwards its own ref straight to the <li> and no extra
// wrapper breaks the "adjacent <li> siblings" assumption tests rely on.
export function BudgetRowsList({
  rows,
  visibleRoots,
  rowsByCategory,
  childrenByParent,
  monthOrYear,
  catRowAnchor,
  onSave,
  onDelete,
  onApplySuggestion,
}: {
  rows: BudgetReportRow[];
  visibleRoots: Category[];
  rowsByCategory: Map<number, BudgetReportRow>;
  childrenByParent: Map<number, Category[]>;
  monthOrYear: string;
  catRowAnchor: (el: HTMLElement | null) => void;
  onSave: (id: number, limit: string) => void;
  onDelete: (id: number) => void;
  onApplySuggestion: (id: number, newLimit: string) => void;
}): JSX.Element {
  let assigned = false;
  const firstRowRef = (): LiRef => {
    if (assigned) return undefined;
    assigned = true;
    return catRowAnchor;
  };

  return (
    <ul className="flex flex-col gap-3">
      {visibleRoots.flatMap((r) => {
        const rootRow = rowsByCategory.get(r.id);
        const nodes: JSX.Element[] = [];
        if (rootRow) {
          // The row now carries its own budget id directly (rootRow.id) —
          // a categoryId-only lookup into `budgets` is ambiguous once a
          // category can have multiple budget rows (monthly + yearly,
          // global + per-account) and can silently mutate the wrong one.
          const budgetId = rootRow.id;
          nodes.push(
            <BudgetRow
              key={`root-${r.id}-${rootRow.id}`}
              ref={firstRowRef()}
              row={rootRow}
              depth={0}
              budgetId={budgetId}
              onSave={onSave}
              onDelete={onDelete}
            />,
          );
          if (rootRow.suggestedLimit != null && budgetId !== undefined) {
            nodes.push(
              <SuggestionCard
                key={`suggest-${r.id}-${rootRow.id}`}
                row={rootRow}
                budgetId={budgetId}
                periodKey={monthOrYear}
                onApply={onApplySuggestion}
              />,
            );
          }
        } else {
          // Parent has no budget of its own but has budgeted children — slim header.
          nodes.push(
            <li key={`header-${r.id}`} ref={firstRowRef()} data-role="budget-row" data-depth={0} className="px-4 py-2 text-sm text-ink-500">
              {r.name}
            </li>,
          );
        }
        for (const c of childrenByParent.get(r.id) ?? []) {
          const row = rowsByCategory.get(c.id);
          if (!row) continue;
          const budgetId = row.id;
          nodes.push(
            <BudgetRow
              key={`child-${c.id}-${row.id}`}
              ref={firstRowRef()}
              row={row}
              depth={1}
              budgetId={budgetId}
              onSave={onSave}
              onDelete={onDelete}
            />,
          );
          if (row.suggestedLimit != null && budgetId !== undefined) {
            nodes.push(
              <SuggestionCard
                key={`suggest-${c.id}-${row.id}`}
                row={row}
                budgetId={budgetId}
                periodKey={monthOrYear}
                onApply={onApplySuggestion}
              />,
            );
          }
        }
        return nodes;
      })}
      {/* Also render any budgeted category whose parent isn't visible (orphaned leaf edge case). */}
      {rows
        .filter((r) => !visibleRoots.some((vr) => vr.id === r.categoryId || (childrenByParent.get(vr.id) ?? []).some((c) => c.id === r.categoryId)))
        .flatMap((r) => {
          const budgetId = r.id;
          const nodes = [
            <BudgetRow
              key={`orphan-${r.categoryId}-${r.id}`}
              ref={firstRowRef()}
              row={r}
              depth={0}
              budgetId={budgetId}
              onSave={onSave}
              onDelete={onDelete}
            />,
          ];
          if (r.suggestedLimit != null && budgetId !== undefined) {
            nodes.push(
              <SuggestionCard
                key={`suggest-orphan-${r.categoryId}-${r.id}`}
                row={r}
                budgetId={budgetId}
                periodKey={monthOrYear}
                onApply={onApplySuggestion}
              />,
            );
          }
          return nodes;
        })}
    </ul>
  );
}
