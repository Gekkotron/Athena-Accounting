import { useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { Category, CategoryKind, CategoryReportRow } from '../../api/types';
import { useCategories, EMPTY_CATEGORIES } from '../../lib/useReferenceData';
import { kindLabel, groupCategories, resolveCategoryColor } from '../../lib/categories';
import { CategoryBreakdown } from '../../components/CategoryBreakdown';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CategoryColorPicker } from './CategoryColorPicker';
import { buildOwnTotalsByCat } from './categoriesTotals';
import { CategoriesTable } from './CategoriesTable';
import { useCategoriesMutations } from './useCategoriesMutations';
import { useAutoStartTour } from '../../hooks/useAutoStartTour';
import { useTourAnchor } from '../../hooks/useTourAnchor';
import { TourReplayIcon } from '../../components/TourReplayIcon';

export function Categories() {
  const { t } = useTranslation(['rules', 'common']);
  const catQ = useCategories();
  const reportQ = useQuery({
    queryKey: ['reports', 'categories'],
    queryFn: () => api<{ rows: CategoryReportRow[] }>('/api/reports/categories'),
  });

  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [color, setColor] = useState('');

  const m = useCategoriesMutations();
  const [colorPickerFor, setColorPickerFor] = useState<Category | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.setError(null);
    m.create.mutate(
      {
        name: name.trim(),
        kind,
        color: color || null,
        parentId: null,
      },
      {
        onSuccess: () => {
          setName('');
          setColor('');
        },
      },
    );
  };

  const cats = catQ.data ?? EMPTY_CATEGORIES;
  const report = useMemo(() => reportQ.data?.rows ?? [], [reportQ.data]);
  const { roots, childrenByParent } = useMemo(() => groupCategories(cats), [cats]);
  const byId = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const ownTotalsByCat = useMemo(() => buildOwnTotalsByCat(report), [report]);

  useAutoStartTour('rules-categories');
  const listAnchor = useTourAnchor('rules-categories:list');
  const createAnchor = useTourAnchor('rules-categories:create');

  const requestDelete = (c: Category) => {
    m.setDeleteError(null);
    setConfirmDelete(c);
  };

  return (
    <div className="relative flex flex-col gap-8">
      <span ref={listAnchor} aria-hidden className="pointer-events-none absolute right-4 top-4 h-1 w-1" />
      <span ref={createAnchor} aria-hidden className="pointer-events-none absolute right-16 top-4 h-1 w-1" />
      <div>
        <div className="flex items-center gap-2">
          <h1 className="page-title">{t('categories.title')}</h1>
          <TourReplayIcon pageId="rules-categories" />
        </div>
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
        <button className="btn-primary" disabled={m.create.isPending}>{t('categories.createForm.submit')}</button>
        {m.error && <div className="text-sm text-clay-300 w-full">{m.error}</div>}
      </form>

      <CategoriesTable
        cats={cats}
        roots={roots}
        childrenByParent={childrenByParent}
        byId={byId}
        ownTotalsByCat={ownTotalsByCat}
        updateCategory={m.updateCategory}
        onOpenColorPicker={setColorPickerFor}
        onRequestDelete={requestDelete}
      />

      <CategoryColorPicker
        open={colorPickerFor !== null}
        categoryName={colorPickerFor?.name ?? ''}
        current={colorPickerFor?.color ?? null}
        defaultColor={colorPickerFor ? resolveCategoryColor(colorPickerFor) : '#7dd3c0'}
        onApply={(picked) => {
          if (colorPickerFor) {
            m.updateCategory.mutate({ id: colorPickerFor.id, patch: { color: picked } });
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
        busy={m.del.isPending}
        error={m.deleteError}
        onConfirm={() => confirmDelete && m.del.mutate(confirmDelete.id, {
          onSuccess: () => setConfirmDelete(null),
        })}
        onCancel={() => {
          setConfirmDelete(null);
          m.setDeleteError(null);
        }}
      />
    </div>
  );
}
