import type { Category } from '../../api/types';
import type { Filters } from './filters';

// Query string for GET /api/transactions/export — the same filter fields the
// list request sends, so the CSV is exactly the on-screen view without its
// page boundary. Unset/empty values are dropped.
export function buildExportUrl(filters: Filters): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  return `/api/transactions/export?${params.toString()}`;
}

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
