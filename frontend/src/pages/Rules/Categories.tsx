import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { api, ApiError } from '../../api/client';
import type { Category, CategoryKind, CategoryReportRow } from '../../api/types';
import { kindLabel, groupCategories, resolveCategoryColor } from '../../lib/categories';
import { CategoryBreakdown } from '../../components/CategoryBreakdown';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { resolveDrop } from './dragNest';
import { CategoryColorPicker } from './CategoryColorPicker';
import { CategoryTableRow } from './CategoryTableRow';
import { DragGhost } from './DragGhost';
import { buildOwnTotalsByCat, rolledUpTotal } from './categoriesTotals';

export function Categories() {
  const { t } = useTranslation(['rules', 'common']);
  const qc = useQueryClient();
  const catQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });
  const reportQ = useQuery({
    queryKey: ['reports', 'categories'],
    queryFn: () => api<{ rows: CategoryReportRow[] }>('/api/reports/categories'),
  });

  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [color, setColor] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (input: {
      name: string;
      kind: CategoryKind;
      color: string | null;
      parentId: number | null;
    }) => api<{ category: Category }>('/api/categories', { method: 'POST', json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      setName('');
      setColor('');
    },
    onError: (err: ApiError) => setError(err.message),
  });
  const updateCategory = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Category> }) =>
      api(`/api/categories/${id}`, { method: 'PUT', json: patch }),
    onMutate: async ({ id, patch }) => {
      // Only take a snapshot when the mutation touches parentId — that's the
      // path drag-and-drop uses; other patches are covered by the standard
      // invalidate-on-success and don't need optimistic rewriting.
      if (!Object.prototype.hasOwnProperty.call(patch, 'parentId')) return;
      await qc.cancelQueries({ queryKey: ['categories'] });
      const previous = qc.getQueryData<{ categories: Category[] }>(['categories']);
      if (previous) {
        const next = {
          categories: previous.categories.map((c) =>
            c.id === id ? { ...c, parentId: patch.parentId ?? null } : c,
          ),
        };
        qc.setQueryData(['categories'], next);
      }
      return { previous } as const;
    },
    onError: (err: ApiError, _vars, context) => {
      if (context?.previous) qc.setQueryData(['categories'], context.previous);
      setError(err.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [activeDragId, setActiveDragId] = useState<number | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [colorPickerFor, setColorPickerFor] = useState<Category | null>(null);

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
          updateCategory.mutate({ id: activeCat.id, patch: { parentId: null } });
          return;
        }
      }
    }

    // Nest / re-parent: dropped onto a root row.
    if (over && typeof over.id === 'number') {
      const resolved = resolveDrop(active.id, over.id, cats);
      if (resolved) {
        updateCategory.mutate({ id: resolved.id, patch: { parentId: resolved.parentId } });
      }
    }
  };

  const onDragCancel = () => setActiveDragId(null);

  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const del = useMutation({
    mutationFn: (id: number) => api(`/api/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['rules'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      setConfirmDelete(null);
      setDeleteError(null);
    },
    onError: (err: ApiError) => setDeleteError(err.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate({
      name: name.trim(),
      kind,
      color: color || null,
      parentId: null,
    });
  };

  const cats = catQ.data?.categories ?? [];
  const report = reportQ.data?.rows ?? [];
  const { roots, childrenByParent } = useMemo(() => groupCategories(cats), [cats]);
  const byId = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);

  const ownTotalsByCat = useMemo(() => buildOwnTotalsByCat(report), [report]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="page-title">{t('categories.title')}</h1>
        <p className="page-subtitle max-w-2xl">
          <Trans i18nKey="rules:categories.subtitle">
            The <span className="display-italic">“kind”</span> feeds the sign guard rail: a category set to “Revenu” never applies to a negative amount. Sub-categories inherit their parent's type.
          </Trans>
        </p>
      </div>

      <section className="surface p-5 md:p-6">
        <div className="section-rule mb-4">{t('categories.breakdownTitle')}</div>
        <CategoryBreakdown defaultRange="3m" />
      </section>

      <form onSubmit={submit} className="surface p-4 md:p-5 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="label mb-1.5 block" htmlFor="cat-create-name">{t('categories.createForm.nameLabel')}</label>
          <input
            id="cat-create-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="w-full sm:w-40">
          <label className="label mb-1.5 block" htmlFor="cat-create-kind">{t('categories.createForm.typeLabel')}</label>
          <select
            id="cat-create-kind"
            className="input"
            value={kind}
            onChange={(e) => setKind(e.target.value as CategoryKind)}
          >
            <option value="expense">{kindLabel('expense', t)}</option>
            <option value="income">{kindLabel('income', t)}</option>
            <option value="neutral">{kindLabel('neutral', t)}</option>
          </select>
        </div>
        <div className="w-full sm:w-32">
          <label className="label mb-1.5 block" htmlFor="cat-create-color">{t('categories.createForm.colorLabel')}</label>
          <input
            id="cat-create-color"
            className="input font-mono"
            value={color}
            placeholder="#7dd3c0"
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        <button className="btn-primary" disabled={create.isPending}>{t('categories.createForm.submit')}</button>
        {error && <div className="text-sm text-clay-300 w-full">{error}</div>}
      </form>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="surface overflow-hidden">
          <div className="table-scroll">
            <table ref={tableRef} className="w-full text-sm">
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
                      onDelete={() => { setDeleteError(null); setConfirmDelete(r); }}
                      onOpenColorPicker={() => setColorPickerFor(r)}
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
                        onDelete={() => { setDeleteError(null); setConfirmDelete(ch); }}
                        onOpenColorPicker={() => setColorPickerFor(ch)}
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

      <CategoryColorPicker
        open={colorPickerFor !== null}
        categoryName={colorPickerFor?.name ?? ''}
        current={colorPickerFor?.color ?? null}
        defaultColor={colorPickerFor ? resolveCategoryColor(colorPickerFor) : '#7dd3c0'}
        onApply={(color) => {
          if (colorPickerFor) {
            updateCategory.mutate({ id: colorPickerFor.id, patch: { color } });
          }
          setColorPickerFor(null);
        }}
        onCancel={() => setColorPickerFor(null)}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete ? t('categories.deleteDialog.title', { name: confirmDelete.name }) : ''}
        description={
          <>
            <Trans i18nKey="rules:categories.deleteDialog.description">
              Rules pointing to this category will also be deleted (cascade). Transactions that were assigned to it will move to <span className="display-italic">no category</span> — you'll be able to find them again via the "Tri" tab.
            </Trans>
            {confirmDelete && (childrenByParent.get(confirmDelete.id) ?? []).length > 0 && (
              <div className="mt-2 text-ink-300">
                {t('categories.deleteDialog.childrenWillBecomeRoots', {
                  count: childrenByParent.get(confirmDelete.id)!.length,
                })}
              </div>
            )}
          </>
        }
        confirmLabel={t('categories.deleteDialog.confirmLabel')}
        destructive
        busy={del.isPending}
        error={deleteError}
        onConfirm={() => confirmDelete && del.mutate(confirmDelete.id)}
        onCancel={() => {
          setConfirmDelete(null);
          setDeleteError(null);
        }}
      />
    </div>
  );
}
