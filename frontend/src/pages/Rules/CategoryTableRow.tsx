import { useCallback } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '../../api/client';
import type { Category, CategoryKind } from '../../api/types';
import { kindBadgeClass, kindLabel, resolveCategoryColor } from '../../lib/categories';
import { formatAmount } from '../../lib/format';

export type UpdateMutation = ReturnType<typeof useMutation<
  unknown, ApiError, { id: number; patch: Partial<Category> }
>>;

export function CategoryTableRow(props: {
  c: Category;
  depth: 0 | 1;
  total: number;
  hasChildren: boolean;
  parent: Category | null;
  childrenByParent: Map<number, Category[]>;
  updateCategory: UpdateMutation;
  onDelete: () => void;
  onOpenColorPicker: () => void;
}): JSX.Element {
  const { t } = useTranslation(['rules', 'common']);
  const { c, depth, total, hasChildren, parent, childrenByParent, updateCategory, onDelete, onOpenColorPicker } = props;

  const kindDisabled = depth === 1;

  const dragDisabled = depth === 0 && hasChildren;
  const draggable = useDraggable({
    id: c.id,
    disabled: dragDisabled,
  });
  // Only root rows are drop targets for nesting.
  const droppable = useDroppable({
    id: c.id,
    disabled: depth === 1,
  });

  const setRowRef = useCallback(
    (node: HTMLTableRowElement | null) => {
      draggable.setNodeRef(node);
      droppable.setNodeRef(node);
    },
    [draggable.setNodeRef, droppable.setNodeRef],
  );

  const isValidDropTarget = depth === 0 && droppable.isOver && draggable.isDragging === false;

  return (
    <tr
      ref={setRowRef}
      data-depth={depth}
      className={
        `border-b border-ink-800/40 last:border-0 hover:bg-ink-850/40 transition ` +
        (depth === 1 ? 'bg-ink-900/20 ' : '') +
        (isValidDropTarget ? 'ring-2 ring-sage-300/60 ' : '') +
        (draggable.isDragging ? 'opacity-40' : '')
      }
    >
      <td className="pl-2 pr-1 py-2.5 w-8">
        <button
          ref={draggable.setActivatorNodeRef}
          type="button"
          disabled={dragDisabled}
          aria-label={t('categories.table.dragHandleAriaLabel', { name: c.name })}
          title={
            dragDisabled
              ? t('categories.table.dragDisabledTitle')
              : undefined
          }
          className={
            `select-none text-ink-500 leading-none px-1 ` +
            (dragDisabled
              ? 'cursor-not-allowed opacity-30'
              : 'cursor-grab active:cursor-grabbing hover:text-ink-300')
          }
          {...draggable.attributes}
          {...draggable.listeners}
        >
          ⋮⋮
        </button>
      </td>
      <td className={`px-4 py-2.5 ${depth === 1 ? 'pl-10' : ''}`}>
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full border border-ink-700 shrink-0"
            style={{ backgroundColor: resolveCategoryColor(c) }}
          />

          <input
            defaultValue={c.name}
            key={`name-${c.id}-${c.name}`}
            className="input-sm flex-1 min-w-0"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== c.name) {
                updateCategory.mutate({ id: c.id, patch: { name: v } });
              } else if (!v) {
                e.target.value = c.name;
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') (e.target as HTMLInputElement).value = c.name;
            }}
          />
          {c.isDefault && <span className="badge ml-1 shrink-0">{t('categories.table.defaultBadge')}</span>}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className={kindBadgeClass(c.kind)}>{kindLabel(c.kind, t)}</span>
          <select
            className="input-sm"
            value={c.kind}
            disabled={kindDisabled}
            aria-label={t('categories.table.columns.type')}
            title={
              kindDisabled && parent
                ? t('categories.table.kindInheritedTitle', { parent: parent.name })
                : undefined
            }
            onChange={(e) => {
              const nextKind = e.target.value as CategoryKind;
              const children = childrenByParent.get(c.id) ?? [];
              if (children.length > 0) {
                const confirmed = window.confirm(
                  t('categories.table.confirmKindChange', { count: children.length }),
                );
                if (!confirmed) {
                  e.target.value = c.kind;
                  return;
                }
              }
              updateCategory.mutate({ id: c.id, patch: { kind: nextKind } });
            }}
          >
            <option value="expense">{kindLabel('expense', t)}</option>
            <option value="income">{kindLabel('income', t)}</option>
            <option value="neutral">{kindLabel('neutral', t)}</option>
          </select>
        </div>
      </td>
      <td className="px-4 py-2.5 hidden md:table-cell text-center">
        <input
          type="checkbox"
          className="accent-sage-300 align-middle"
          checked={c.isInternalTransfer}
          aria-label={t('categories.table.markInternalAriaLabel', { name: c.name })}
          onChange={(e) =>
            updateCategory.mutate({
              id: c.id,
              patch: { isInternalTransfer: e.target.checked },
            })
          }
        />
      </td>
      <td className="px-4 py-2.5 hidden sm:table-cell">
        <button
          type="button"
          onClick={onOpenColorPicker}
          aria-label={
            c.color
              ? t('categories.table.editColorAriaLabel', { name: c.name, color: c.color })
              : t('categories.table.chooseColorAriaLabel', { name: c.name })
          }
          title={
            c.color
              ? undefined
              : t('categories.table.autoColorTitle')
          }
          className={
            `h-6 w-6 rounded-full border transition ` +
            (c.color
              ? 'border-ink-700 hover:border-ink-400'
              : 'border-dashed border-ink-600 hover:border-ink-400')
          }
          style={{ backgroundColor: resolveCategoryColor(c) }}
        />
      </td>
      <td
        className={`px-4 py-2.5 text-right font-mono tabular-nums ${
          total < 0 ? 'text-clay-300' : total > 0 ? 'text-sage-300' : 'text-ink-500'
        }`}
      >
        {formatAmount(total)}
      </td>
      <td className="px-4 py-2.5 text-right">
        {!c.isDefault && (
          <button
            className="text-[11px] text-ink-500 hover:text-clay-300 transition"
            onClick={onDelete}
          >
            {t('categories.table.deleteRow')}
          </button>
        )}
      </td>
    </tr>
  );
}
