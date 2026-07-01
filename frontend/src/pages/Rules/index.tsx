import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Category, MatchMode, Rule, SignConstraint } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { AdvancedEditor } from './AdvancedEditor';
import { FlatTable } from './FlatTable';
import { GroupedView } from './GroupedView';
import { RuleCreateForm } from './RuleCreateForm';
import type { GroupedEntry } from './types';

type View = 'grouped' | 'flat';

export function Rules() {
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

  const cats = catQ.data?.categories ?? [];
  const rules = rulesQ.data?.rules ?? [];

  // Group rules by category. Include every category even if it has no rule
  // yet — they all get a "+ ajouter" affordance, which makes the page useful
  // as a directory.
  const grouped = useMemo<GroupedEntry[]>(() => {
    const byId = new Map<number, GroupedEntry>();
    for (const c of cats) byId.set(c.id, { category: c, rules: [] });
    for (const r of rules) {
      const g = byId.get(r.categoryId);
      if (g) g.rules.push(r);
    }
    for (const g of byId.values()) {
      g.rules.sort(
        (a, b) => b.priority - a.priority || a.keyword.localeCompare(b.keyword),
      );
    }
    return Array.from(byId.values()).sort((a, b) => {
      // Categories with rules first, then alphabetical.
      if ((b.rules.length > 0 ? 1 : 0) !== (a.rules.length > 0 ? 1 : 0)) {
        return (b.rules.length > 0 ? 1 : 0) - (a.rules.length > 0 ? 1 : 0);
      }
      return a.category.name.localeCompare(b.category.name);
    });
  }, [rules, cats]);

  return (
    <div className="flex flex-col gap-8">
      <div className="page-header">
        <div>
          <h1 className="page-title">Règles</h1>
          <p className="page-subtitle max-w-2xl">
            Matching <span className="display-italic">insensible aux accents/casse</span>.
            « Mot entier » empêche « paye » de matcher « payweb ».
          </p>
        </div>
        <button
          className="btn-secondary"
          onClick={() => setConfirmRecat(true)}
          disabled={recategorize.isPending}
        >
          {recategorize.isPending ? 'Recatégorisation…' : 'Recatégoriser l\'historique'}
        </button>
      </div>

      {recategorize.data && (
        <div className="surface p-4 text-sm text-sage-200">
          Total <span className="font-mono">{recategorize.data.total}</span> · recatégorisées{' '}
          <span className="font-mono text-sage-300">{recategorize.data.recategorized}</span> · inconnues{' '}
          <span className="font-mono">{recategorize.data.unknown}</span> · manuelles préservées{' '}
          <span className="font-mono">{recategorize.data.preserved}</span>
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
            Par catégorie
          </button>
          <button
            onClick={() => setView('flat')}
            className={`px-3 py-1.5 rounded-md transition ${
              view === 'flat' ? 'bg-ink-850 text-ink-100' : 'text-ink-400 hover:text-ink-100'
            }`}
          >
            Détaillé
          </button>
        </div>
      </div>

      {view === 'grouped' ? (
        <GroupedView
          grouped={grouped}
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
        title={confirmDeleteRule ? `Supprimer la règle « ${confirmDeleteRule.keyword} » ?` : ''}
        description="La règle ne sera plus appliquée aux imports futurs. Les transactions déjà catégorisées par elle restent en place — relancez « Recatégoriser l'historique » si vous voulez réévaluer."
        confirmLabel="Supprimer la règle"
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
        title="Recatégoriser tout l'historique ?"
        description={
          <>
            Toutes les règles activées sont ré-appliquées à l'ensemble des transactions
            (hors virements internes). Vos{' '}
            <span className="display-italic">choix manuels</span> sont préservés — seules
            les transactions en source « auto » ou « default » sont réévaluées.
          </>
        }
        confirmLabel="Recatégoriser"
        busy={recategorize.isPending}
        onConfirm={() =>
          recategorize.mutate(undefined, { onSuccess: () => setConfirmRecat(false) })
        }
        onCancel={() => setConfirmRecat(false)}
      />
    </div>
  );
}

