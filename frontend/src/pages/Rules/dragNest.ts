import type { Category } from '../../api/types';

// resolveDrop only handles the nest / re-parent case (drop onto a root row).
// The "promote back to root" gesture is a horizontal-drag detection handled
// inline in Categories.tsx onDragEnd — it doesn't need a droppable target.
export function resolveDrop(
  activeId: number,
  targetId: number,
  categories: Category[],
): { id: number; parentId: number } | null {
  const active = categories.find((c) => c.id === activeId);
  if (!active) return null;
  if (targetId === activeId) return null;
  if (active.parentId === targetId) return null;

  const targetCat = categories.find((c) => c.id === targetId);
  if (!targetCat) return null;
  if (targetCat.parentId != null) return null;

  const hasChildren = categories.some((c) => c.parentId === activeId);
  if (hasChildren) return null;

  return { id: activeId, parentId: targetId };
}
