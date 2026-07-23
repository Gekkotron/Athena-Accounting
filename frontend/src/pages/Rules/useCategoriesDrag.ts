import { useState, type RefObject } from 'react';
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { Category } from '../../api/types';
import { resolveDrop } from './dragNest';

export function useCategoriesDrag(config: {
  cats: Category[];
  tableRef: RefObject<HTMLTableElement>;
  onReparent: (id: number, parentId: number | null) => void;
}) {
  const { cats, tableRef, onReparent } = config;
  const [activeDragId, setActiveDragId] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = (e: DragStartEvent) => {
    if (typeof e.active.id === 'number') setActiveDragId(e.active.id);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over, delta, activatorEvent } = e;
    if (typeof active.id !== 'number') return;

    const activeCat = cats.find((c) => c.id === active.id);

    // Promote (checked first): if the pointer ended up LEFT of the table's
    // left edge, un-nest the child. Runs before the drop-target branch
    // because closestCenter almost always picks some root row as `over` —
    // guarding on `!over` would make this branch unreachable.
    if (activeCat && activeCat.parentId != null && activatorEvent) {
      const evt = activatorEvent as { clientX?: number };
      const tableRect = tableRef.current?.getBoundingClientRect();
      if (typeof evt.clientX === 'number' && tableRect) {
        const endPointerX = evt.clientX + delta.x;
        if (endPointerX < tableRect.left) {
          onReparent(activeCat.id, null);
          return;
        }
      }
    }

    // Nest / re-parent: dropped onto a root row.
    if (over && typeof over.id === 'number') {
      const resolved = resolveDrop(active.id, over.id, cats);
      if (resolved) {
        onReparent(resolved.id, resolved.parentId);
      }
    }
  };

  const onDragCancel = () => setActiveDragId(null);

  return { activeDragId, sensors, onDragStart, onDragEnd, onDragCancel };
}
