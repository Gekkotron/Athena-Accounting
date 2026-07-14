import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { api, ApiError } from '../../api/client';
import type { Category, CategoryKind, CategoryReportRow } from '../../api/types';
import { formatAmount } from '../../lib/format';
import { KIND_LABEL, kindBadgeClass, groupCategories } from '../../lib/categories';
import { CategoryBreakdown } from '../../components/CategoryBreakdown';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { resolveDrop } from './dragNest';

// A horizontal drag by more than this many pixels to the LEFT, when the row
// isn't dropped on a target, promotes a child back to root. Chosen to feel
// intentional — small jitter shouldn't trigger it.
const PROMOTE_LEFT_DRAG_PX = -60;

export function Categories() {
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

  const onDragStart = (e: DragStartEvent) => {
    if (typeof e.active.id === 'number') setActiveDragId(e.active.id);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over, delta } = e;
    if (typeof active.id !== 'number') return;

    // Nest / re-parent: dropped onto a root row.
    if (over && typeof over.id === 'number') {
      const resolved = resolveDrop(active.id, over.id, cats);
      if (resolved) {
        updateCategory.mutate({ id: resolved.id, patch: { parentId: resolved.parentId } });
      }
      return;
    }

    // Promote: no drop target, but the child was dragged far enough LEFT.
    const activeCat = cats.find((c) => c.id === active.id);
    if (activeCat && activeCat.parentId != null && delta.x < PROMOTE_LEFT_DRAG_PX) {
      updateCategory.mutate({ id: activeCat.id, patch: { parentId: null } });
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

  const ownTotalsByCat = new Map<number, number>();
  for (const r of report) {
    if (r.category_id == null) continue;
    const prev = ownTotalsByCat.get(r.category_id) ?? 0;
    ownTotalsByCat.set(r.category_id, prev + Number(r.total));
  }
  const rolledUpTotal = (c: Category): number => {
    let sum = ownTotalsByCat.get(c.id) ?? 0;
    for (const ch of childrenByParent.get(c.id) ?? []) {
      sum += ownTotalsByCat.get(ch.id) ?? 0;
    }
    return sum;
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="page-title">Catégories</h1>
        <p className="page-subtitle max-w-2xl">
          Le <span className="display-italic">« kind »</span> alimente le garde-fou de signe :
          une catégorie « Revenu » ne s'applique jamais à un montant négatif. Les sous-catégories
          héritent du type de leur parent.
        </p>
      </div>

      <section className="surface p-5 md:p-6">
        <div className="section-rule mb-4">Répartition par catégorie</div>
        <CategoryBreakdown defaultRange="3m" />
      </section>

      <form onSubmit={submit} className="surface p-4 md:p-5 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="label mb-1.5 block" htmlFor="cat-create-name">Nom</label>
          <input
            id="cat-create-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="w-full sm:w-40">
          <label className="label mb-1.5 block" htmlFor="cat-create-kind">Type</label>
          <select
            id="cat-create-kind"
            className="input"
            value={kind}
            onChange={(e) => setKind(e.target.value as CategoryKind)}
          >
            <option value="expense">Dépense</option>
            <option value="income">Revenu</option>
            <option value="neutral">Neutre</option>
          </select>
        </div>
        <div className="w-full sm:w-32">
          <label className="label mb-1.5 block" htmlFor="cat-create-color">Couleur</label>
          <input
            id="cat-create-color"
            className="input font-mono"
            value={color}
            placeholder="#7dd3c0"
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        <button className="btn-primary" disabled={create.isPending}>Ajouter</button>
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
            <table className="w-full text-sm">
              <thead className="text-left">
                <tr className="border-b border-ink-800/70">
                  <th className="px-2 py-3 w-8" aria-hidden />
                  <th className="px-4 py-3 label font-normal">Nom</th>
                  <th className="px-4 py-3 label font-normal">Type</th>
                  <th
                    className="px-4 py-3 label font-normal hidden md:table-cell text-center"
                    title="Exclut la catégorie des moyennes mensuelles (dépenses/revenus). Utile pour marquer un mouvement interne — épargne, transfert entre comptes — sans passer par la détection automatique."
                  >
                    Interne
                  </th>
                  <th className="px-4 py-3 label font-normal hidden sm:table-cell">Couleur</th>
                  <th className="px-4 py-3 label font-normal text-right">Total (période chargée)</th>
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
                      total={rolledUpTotal(r)}
                      hasChildren={children.length > 0}
                      parent={null}
                      childrenByParent={childrenByParent}
                      updateCategory={updateCategory}
                      onDelete={() => { setDeleteError(null); setConfirmDelete(r); }}
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

      <ConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete ? `Supprimer « ${confirmDelete.name} » ?` : ''}
        description={
          <>
            Les règles pointant vers cette catégorie seront aussi supprimées (cascade).
            Les transactions qui y étaient assignées passeront en{' '}
            <span className="display-italic">sans catégorie</span> — vous pourrez les
            retrouver via l'onglet « Tri ».
            {confirmDelete && (childrenByParent.get(confirmDelete.id) ?? []).length > 0 && (
              <div className="mt-2 text-ink-300">
                Ses {childrenByParent.get(confirmDelete.id)!.length} sous-catégories
                deviendront des catégories racine.
              </div>
            )}
          </>
        }
        confirmLabel="Supprimer la catégorie"
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

type UpdateMutation = ReturnType<typeof useMutation<
  unknown, ApiError, { id: number; patch: Partial<Category> }
>>;

function CategoryTableRow(props: {
  c: Category;
  depth: 0 | 1;
  total: number;
  hasChildren: boolean;
  parent: Category | null;
  childrenByParent: Map<number, Category[]>;
  updateCategory: UpdateMutation;
  onDelete: () => void;
}): JSX.Element {
  const { c, depth, total, hasChildren, parent, childrenByParent, updateCategory, onDelete } = props;

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
          aria-label={`Déplacer la catégorie « ${c.name} »`}
          title={
            dragDisabled
              ? 'Cette catégorie a des sous-catégories — elle ne peut pas être imbriquée.'
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
          {c.color && (
            <span
              className="h-2 w-2 rounded-full border border-ink-700 shrink-0"
              style={{ backgroundColor: c.color }}
            />
          )}
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
          {c.isDefault && <span className="badge ml-1 shrink-0">défaut</span>}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className={kindBadgeClass(c.kind)}>{KIND_LABEL[c.kind]}</span>
          <select
            className="input-sm"
            value={c.kind}
            disabled={kindDisabled}
            aria-label="Type"
            title={
              kindDisabled && parent
                ? `Type hérité de « ${parent.name} »`
                : undefined
            }
            onChange={(e) => {
              const nextKind = e.target.value as CategoryKind;
              const children = childrenByParent.get(c.id) ?? [];
              if (children.length > 0) {
                const confirmed = window.confirm(
                  `Changer aussi le type des ${children.length} sous-catégories ?`,
                );
                if (!confirmed) {
                  e.target.value = c.kind;
                  return;
                }
              }
              updateCategory.mutate({ id: c.id, patch: { kind: nextKind } });
            }}
          >
            <option value="expense">Dépense</option>
            <option value="income">Revenu</option>
            <option value="neutral">Neutre</option>
          </select>
        </div>
      </td>
      <td className="px-4 py-2.5 hidden md:table-cell text-center">
        <input
          type="checkbox"
          className="accent-sage-300 align-middle"
          checked={c.isInternalTransfer}
          aria-label={`Marquer « ${c.name} » comme mouvement interne`}
          onChange={(e) =>
            updateCategory.mutate({
              id: c.id,
              patch: { isInternalTransfer: e.target.checked },
            })
          }
        />
      </td>
      <td className="px-4 py-2.5 hidden sm:table-cell">
        <input
          type="text"
          defaultValue={c.color ?? ''}
          key={`color-${c.id}-${c.color ?? ''}`}
          placeholder="#7dd3c0"
          className="input-sm font-mono w-28"
          onBlur={(e) => {
            const raw = e.target.value.trim();
            if (raw === '') {
              if (c.color !== null) {
                updateCategory.mutate({ id: c.id, patch: { color: null } });
              }
            } else if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(raw)) {
              if (raw !== c.color) {
                updateCategory.mutate({ id: c.id, patch: { color: raw } });
              }
            } else {
              e.target.value = c.color ?? '';
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') (e.target as HTMLInputElement).value = c.color ?? '';
          }}
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
            supprimer
          </button>
        )}
      </td>
    </tr>
  );
}

function DragGhost({
  id,
  byId,
}: {
  id: number;
  byId: Map<number, Category>;
}): JSX.Element | null {
  const c = byId.get(id);
  if (!c) return null;
  return (
    <div className="surface px-3 py-2 text-sm flex items-center gap-2 shadow-lg">
      {c.color && (
        <span
          className="h-2 w-2 rounded-full border border-ink-700 shrink-0"
          style={{ backgroundColor: c.color }}
        />
      )}
      <span>{c.name}</span>
      <span className={kindBadgeClass(c.kind)}>{KIND_LABEL[c.kind]}</span>
    </div>
  );
}
