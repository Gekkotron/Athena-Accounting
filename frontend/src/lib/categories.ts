import type { Category, CategoryKind } from '../api/types';

export const KIND_LABEL: Record<CategoryKind, string> = {
  expense: 'Dépense',
  income: 'Revenu',
  neutral: 'Neutre',
};

// Tailwind class set for a small kind badge. Palette is intentionally low
// saturation — the badge is a hint, not the focal point of the row.
export function kindBadgeClass(kind: CategoryKind): string {
  const base = 'inline-flex items-center rounded-full border px-2 py-[1px] text-[10px] font-medium leading-none tracking-wide uppercase';
  const tone: Record<CategoryKind, string> = {
    expense: 'bg-clay-900/25 text-clay-200 border-clay-800/50',
    income: 'bg-sage-900/25 text-sage-200 border-sage-800/50',
    neutral: 'bg-ink-800/60 text-ink-400 border-ink-700/50',
  };
  return `${base} ${tone[kind]}`;
}

// Renders a category name with its parent path when nested:
//   root      -> "Courses"
//   nested    -> "Courses › Alimentation"
//   orphaned  -> "Alimentation"  (parent missing from the local map)
// The '›' glyph is U+203A; the same used in the design mocks.
export function formatCategoryPath(
  cat: Category,
  byId: Map<number, Category>,
): string {
  if (cat.parentId == null) return cat.name;
  const parent = byId.get(cat.parentId);
  return parent ? `${parent.name} › ${cat.name}` : cat.name;
}

// Splits a flat category list into root categories and a lookup of children
// keyed by parent id (children sorted alphabetically). Used by pages that
// render a two-level parent/child grouping (Categories, Budgets).
export function groupCategories(cats: Category[]): {
  roots: Category[];
  childrenByParent: Map<number, Category[]>;
} {
  const roots: Category[] = [];
  const childrenByParent = new Map<number, Category[]>();
  for (const c of cats) {
    if (c.parentId == null) roots.push(c);
    else {
      const list = childrenByParent.get(c.parentId) ?? [];
      list.push(c);
      childrenByParent.set(c.parentId, list);
    }
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return { roots, childrenByParent };
}
