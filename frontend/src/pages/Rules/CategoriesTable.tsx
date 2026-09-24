import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core';
import type { Category } from '../../api/types';
import { CategoryTableRow, type UpdateMutation } from './CategoryTableRow';
import { DragGhost } from './DragGhost';
import { rolledUpTotal } from './categoriesTotals';
import { useCategoriesDrag } from './useCategoriesDrag';

// The Categories page's drag-and-drop-enabled tree table. Ownership of
// the drag state stays here so the parent doesn't touch @dnd-kit APIs
// directly.
export function CategoriesTable({
  cats,
  roots,
  childrenByParent,
  byId,
  ownTotalsByCat,
  updateCategory,
  onOpenColorPicker,
  onRequestDelete,
}: {
  cats: Category[];
  roots: Category[];
  childrenByParent: Map<number, Category[]>;
  byId: Map<number, Category>;
  ownTotalsByCat: Map<number, number>;
  updateCategory: UpdateMutation;
  onOpenColorPicker: (c: Category) => void;
  onRequestDelete: (c: Category) => void;
}): JSX.Element {
  const { t } = useTranslation('rules');
  const tableRef = useRef<HTMLTableElement>(null);
  const { activeDragId, sensors, onDragStart, onDragEnd, onDragCancel } = useCategoriesDrag({
    cats,
    tableRef,
    onReparent: (id, parentId) => updateCategory.mutate({ id, patch: { parentId } }),
  });

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="surface overflow-hidden">
        <div className="table-scroll">
          <table ref={tableRef} className="w-full text-sm stack-md">
            <thead className="text-left">
              <tr className="border-b border-ink-800/70">
                <th className="px-2 py-3 w-8" aria-hidden />
                <th className="px-4 py-3 label font-normal">{t('categories.table.columns.name')}</th>
                <th className="px-4 py-3 label font-normal">{t('categories.table.columns.type')}</th>
                <th
                  className="px-4 py-3 label font-normal hidden md:table-cell text-center"
                  title={t('categories.table.columns.internalTitle')}
                >
                  {t('categories.table.columns.internal')}
                </th>
                <th className="px-4 py-3 label font-normal hidden sm:table-cell">{t('categories.table.columns.color')}</th>
                <th className="px-4 py-3 label font-normal text-right">{t('categories.table.columns.total')}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {roots.flatMap((r) => {
                const children = childrenByParent.get(r.id) ?? [];
                const rows: JSX.Element[] = [
                  <CategoryTableRow
                    key={`root-${r.id}`}
                    c={r}
                    depth={0}
                    total={rolledUpTotal(r, ownTotalsByCat, childrenByParent)}
                    hasChildren={children.length > 0}
                    parent={null}
                    childrenByParent={childrenByParent}
                    updateCategory={updateCategory}
                    onDelete={() => onRequestDelete(r)}
                    onOpenColorPicker={() => onOpenColorPicker(r)}
                  />,
                  ...children.map((ch) => (
                    <CategoryTableRow
                      key={`child-${ch.id}`}
                      c={ch}
                      depth={1}
                      total={ownTotalsByCat.get(ch.id) ?? 0}
                      hasChildren={false}
                      parent={r}
                      childrenByParent={childrenByParent}
                      updateCategory={updateCategory}
                      onDelete={() => onRequestDelete(ch)}
                      onOpenColorPicker={() => onOpenColorPicker(ch)}
                    />
                  )),
                  <tr
                    key={`spacer-${r.id}`}
                    data-spacer="true"
                    aria-hidden="true"
                  >
                    <td colSpan={7} className="h-3" />
                  </tr>,
                ];
                return rows;
              })}
            </tbody>
          </table>
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {activeDragId != null ? <DragGhost id={activeDragId} byId={byId} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
