import type { TFunction } from 'i18next';
import type { Category, CategoryKind } from '../api/types';

// Curated 10-color palette shared with Sankey, CategoryDonut, and the
// CategoryColorPicker so a category's color stays visually consistent
// across every view.
export const CATEGORY_FALLBACK_PALETTE = [
  '#7dd3c0', // sage
  '#dc7861', // clay
  '#d4a05a', // gold
  '#7aa8d4', // sky
  '#b08fd4', // lavender
  '#97b87f', // moss
  '#d48ba8', // dusty rose
  '#6cc1bb', // teal
  '#caa97a', // sand
  '#9cb6d4', // steel blue
];

// Resolve a stable display color for a category: uses `c.color` when set,
// otherwise a deterministic palette entry indexed by `c.id`. Stable across
// views because it doesn't depend on sort order — a category that has no
// explicit color will always render the same fallback.
export function resolveCategoryColor(c: Category): string {
  if (c.color) return c.color;
  return CATEGORY_FALLBACK_PALETTE[c.id % CATEGORY_FALLBACK_PALETTE.length]!;
}

// Translated label for a category kind. Looked up from the shared 'common'
// namespace regardless of which namespace the caller's `t` is bound to —
// pass any component's `t` (e.g. from useTranslation('rules')) as long as
// its useTranslation call also declares 'common' so the namespace is
// preloaded and doesn't suspend mid-render.
export function kindLabel(kind: CategoryKind, t: TFunction): string {
  return t(`kind.${kind}`, { ns: 'common' });
}

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
