import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import { api, ApiError } from '../../api/client';
import type { Category, MatchMode, Rule, SignConstraint } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { AdvancedEditor } from './AdvancedEditor';
import { FlatTable } from './FlatTable';
import { GroupedView } from './GroupedView';
import { RuleCreateForm } from './RuleCreateForm';
import type { GroupedEntry } from './types';
import { ErrorState, LoadingBlock } from '../../components/StateBlocks';
import { useAutoStartTour } from '../../hooks/useAutoStartTour';
import { useTourAnchor } from '../../hooks/useTourAnchor';
import { TourReplayIcon } from '../../components/TourReplayIcon';

type View = 'grouped' | 'flat';

export function Rules() {
  const { t } = useTranslation('rules');
  const qc = useQueryClient();
  const rulesQ = useQuery({
    queryKey: ['rules'],
    queryFn: () => api<{ rules: Rule[] }>('/api/rules'),
  });
  const catQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });

  const [view, setView] = useState<View>('grouped');
  const [editing, setEditing] = useState<Rule | null>(null);
  // One global "are you sure?" target for any rule deletion across all the
  // sub-views (chips, flat table, advanced editor).
  const [confirmDeleteRule, setConfirmDeleteRule] = useState<Rule | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmRecat, setConfirmRecat] = useState(false);

  const createBatch = useMutation({
    mutationFn: async (input: {
      keywords: string[];
      categoryId: number;
      signConstraint: SignConstraint;
      matchMode: MatchMode;
      priority: number;
    }) => {
      await Promise.all(
        input.keywords.map((kw) =>
          api('/api/rules', {
            method: 'POST',
            json: {
              keyword: kw,
              categoryId: input.categoryId,
              signConstraint: input.signConstraint,
              matchMode: input.matchMode,
              priority: input.priority,
            },
          }),
        ),
      );
      return input.keywords.length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rules'] });
    },
  });

  const updateRule = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Rule> }) =>
      api(`/api/rules/${id}`, { method: 'PUT', json: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });

  const del = useMutation({
    mutationFn: (id: number) => api(`/api/rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rules'] });
      setConfirmDeleteRule(null);
      setDeleteError(null);
      // If the deleted rule was open in the advanced editor, close it.
      if (editing && confirmDeleteRule && editing.id === confirmDeleteRule.id) {
        setEditing(null);
      }
    },
    onError: (err: ApiError) => setDeleteError(err.message),
  });

  const recategorize = useMutation({
    mutationFn: () =>
      api<{ total: number; recategorized: number; unknown: number; preserved: number }>(
        '/api/recategorize',
        { method: 'POST', json: { preserveManual: true } },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['tri-groups'] });
    },
  });

  useAutoStartTour('rules-list');
  const overviewAnchor = useTourAnchor('rules-list:overview');
  const reapplyAnchor = useTourAnchor('rules-list:reapply');

  const cats = catQ.data?.categories ?? [];
  const rules = rulesQ.data?.rules ?? [];
  const byId = useMemo(
    () => new Map(cats.map((c) => [c.id, c] as const)),
    [cats],
  );

  // Group rules by category. Include every category even if it has no rule
  // yet — they all get a "+ ajouter" affordance, which makes the page useful
  // as a directory.
  const grouped = useMemo<GroupedEntry[]>(() => {
    const entryById = new Map<number, GroupedEntry>();
    for (const c of cats) entryById.set(c.id, { category: c, rules: [] });
    for (const r of rules) {
      const g = entryById.get(r.categoryId);
      if (g) g.rules.push(r);
    }
    for (const g of entryById.values()) {
      g.rules.sort(
        (a, b) => b.priority - a.priority || a.keyword.localeCompare(b.keyword),
      );
    }
    return Array.from(entryById.values()).sort((a, b) => {
      // Categories with rules first, then alphabetical.
      if ((b.rules.length > 0 ? 1 : 0) !== (a.rules.length > 0 ? 1 : 0)) {
        return (b.rules.length > 0 ? 1 : 0) - (a.rules.length > 0 ? 1 : 0);
      }
      const aPath = a.category.parentId != null
        ? (byId.get(a.category.parentId)?.name ?? '') + ' › ' + a.category.name
        : a.category.name;
      const bPath = b.category.parentId != null
        ? (byId.get(b.category.parentId)?.name ?? '') + ' › ' + b.category.name
        : b.category.name;
      return aPath.localeCompare(bPath);
    });
  }, [rules, cats, byId]);

  return (
    <div className="relative flex flex-col gap-8">
      <span ref={overviewAnchor} aria-hidden className="pointer-events-none absolute right-4 top-4 h-1 w-1" />
      <span ref={reapplyAnchor} aria-hidden className="pointer-events-none absolute right-16 top-4 h-1 w-1" />
      <div className="page-header">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="page-title">{t('title')}</h1>
            <TourReplayIcon pageId="rules-list" />
          </div>
          <p className="page-subtitle max-w-2xl">
            <Trans i18nKey="rules:subtitle">
              Matching <span className="display-italic">is accent/case-insensitive</span>. "Whole word" prevents "paye" from matching "payweb".
            </Trans>
          </p>
        </div>
        <button
          className="btn-secondary"
          onClick={() => setConfirmRecat(true)}
          disabled={recategorize.isPending}
        >
          {recategorize.isPending ? t('recategorize.pending') : t('recategorize.button')}
        </button>
      </div>

      {recategorize.data && (
        <div className="surface p-4 text-sm text-sage-200">
          {t('recategorize.summary.total')} <span className="font-mono">{recategorize.data.total}</span> ·{' '}
          {t('recategorize.summary.recategorized')}{' '}
          <span className="font-mono text-sage-300">{recategorize.data.recategorized}</span> ·{' '}
          {t('recategorize.summary.unknown')} <span className="font-mono">{recategorize.data.unknown}</span> ·{' '}
          {t('recategorize.summary.preserved')} <span className="font-mono">{recategorize.data.preserved}</span>
        </div>
      )}

      <RuleCreateForm
        categories={cats}
        onSubmit={(values) => createBatch.mutate(values)}
        submitting={createBatch.isPending}
        successCount={createBatch.isSuccess ? createBatch.data : undefined}
      />

      {/* View toggle */}
      <div className="flex items-center justify-end gap-2">
        <div className="inline-flex rounded-lg border border-ink-800 bg-ink-900/60 p-0.5 text-xs">
          <button
            onClick={() => setView('grouped')}
            className={`px-3 py-1.5 rounded-md transition ${
              view === 'grouped' ? 'bg-ink-850 text-ink-100' : 'text-ink-400 hover:text-ink-100'
            }`}
          >
            {t('view.grouped')}
          </button>
          <button
            onClick={() => setView('flat')}
            className={`px-3 py-1.5 rounded-md transition ${
              view === 'flat' ? 'bg-ink-850 text-ink-100' : 'text-ink-400 hover:text-ink-100'
            }`}
          >
            {t('view.flat')}
          </button>
        </div>
      </div>

      {(rulesQ.isError || catQ.isError) ? (
        <ErrorState
          title={t('listErrorTitle')}
          error={rulesQ.error ?? catQ.error}
          onRetry={() => {
            void rulesQ.refetch();
            void catQ.refetch();
          }}
        />
      ) : (rulesQ.isLoading || catQ.isLoading) ? (
        <LoadingBlock height="min-h-48" />
      ) : view === 'grouped' ? (
        <GroupedView
          grouped={grouped}
          byId={byId}
          createBatch={createBatch}
          updateRule={updateRule}
          onRequestDelete={(rule) => {
            setDeleteError(null);
            setConfirmDeleteRule(rule);
          }}
          onEdit={setEditing}
        />
      ) : (
        <FlatTable
          rules={rules}
          cats={cats}
          updateRule={updateRule}
          onRequestDelete={(rule) => {
            setDeleteError(null);
            setConfirmDeleteRule(rule);
          }}
        />
      )}

      {editing && (
        <AdvancedEditor
          key={editing.id}
          rule={editing}
          categories={cats}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            updateRule.mutate(
              { id: editing.id, patch },
              { onSuccess: () => setEditing(null) },
            );
          }}
          onDelete={() => {
            setDeleteError(null);
            setConfirmDeleteRule(editing);
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirmDeleteRule}
        title={confirmDeleteRule ? t('deleteRuleDialog.title', { keyword: confirmDeleteRule.keyword }) : ''}
        description={t('deleteRuleDialog.description')}
        confirmLabel={t('deleteRuleDialog.confirmLabel')}
        destructive
        busy={del.isPending}
        error={deleteError}
        onConfirm={() => confirmDeleteRule && del.mutate(confirmDeleteRule.id)}
        onCancel={() => {
          setConfirmDeleteRule(null);
          setDeleteError(null);
        }}
      />

      <ConfirmDialog
        open={confirmRecat}
        title={t('recategorize.dialog.title')}
        description={
          <Trans i18nKey="rules:recategorize.dialog.description">
            All enabled rules are re-applied to every transaction (excluding internal transfers). Your <span className="display-italic">manual choices</span> are preserved — only
            transactions with source "auto" or "default" are re-evaluated.
          </Trans>
        }
        confirmLabel={t('recategorize.dialog.confirmLabel')}
        busy={recategorize.isPending}
        onConfirm={() =>
          recategorize.mutate(undefined, { onSuccess: () => setConfirmRecat(false) })
        }
        onCancel={() => setConfirmRecat(false)}
      />
    </div>
  );
}

