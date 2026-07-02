import type { CategoryKind } from '../api/types';

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
