import type { Category } from '../../api/types';

// Sorts categories parent-then-child alphabetically for the Tri page's
// two <select>s. Kept out of TriGroupRow.tsx so that file exports only
// a component (react-refresh/only-export-components).
export function sortedCategoryOptions(categories: Category[], byId: Map<number, Category>): Category[] {
  return [...categories].sort((a, b) => {
    const pa = a.parentId != null ? byId.get(a.parentId)?.name ?? '' : a.name;
    const pb = b.parentId != null ? byId.get(b.parentId)?.name ?? '' : b.name;
    return pa.localeCompare(pb) || a.name.localeCompare(b.name);
  });
}
