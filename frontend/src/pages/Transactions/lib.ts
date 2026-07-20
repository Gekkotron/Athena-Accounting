import type { Category } from '../../api/types';

// URL-param → positive-int-or-undefined. Used at mount time to pick up
// deep-link `?accountId=…` / `?sourceFileId=…` from Dashboard / Imports.
export function readIntParam(sp: URLSearchParams, key: string): number | undefined {
  const v = sp.get(key);
  if (!v) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

// Sort order for the bulk-categorize dropdown: parent name first, then
// child name. Subcategory rows use their parent's name for grouping so all
// children of one parent land contiguously in the picker.
export function sortCategoriesForPicker(
  categories: Category[],
  catById: Map<number, Category>,
): Category[] {
  return [...categories].sort((a, b) => {
    const pa = a.parentId != null ? catById.get(a.parentId)?.name ?? '' : a.name;
    const pb = b.parentId != null ? catById.get(b.parentId)?.name ?? '' : b.name;
    return pa.localeCompare(pb) || a.name.localeCompare(b.name);
  });
}

// Immutable set toggle — used for selectedIds / expandedIds patterns where
// the caller receives the previous set and returns the next one.
export function toggleInSet<T>(set: Set<T>, id: T, on: boolean): Set<T> {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}
