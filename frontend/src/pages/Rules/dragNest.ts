import type { Category } from '../../api/types';

export const PROMOTE_DROP_ID = 'promote-root';

export type DragTarget =
  | { kind: 'root'; targetId: number }
  | { kind: 'promote' };

export function resolveDrop(
  activeId: number,
  target: DragTarget | null,
  categories: Category[],
): { id: number; parentId: number | null } | null {
  if (!target) return null;
  const active = categories.find((c) => c.id === activeId);
  if (!active) return null;

  if (target.kind === 'promote') {
    if (active.parentId == null) return null;
    return { id: activeId, parentId: null };
  }

  // target.kind === 'root'
  if (target.targetId === activeId) return null;
  if (active.parentId === target.targetId) return null;

  const targetCat = categories.find((c) => c.id === target.targetId);
  if (!targetCat) return null;
  if (targetCat.parentId != null) return null;

  const hasChildren = categories.some((c) => c.parentId === activeId);
  if (hasChildren) return null;

  return { id: activeId, parentId: target.targetId };
}
