import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Category, MatchMode, Rule, SignConstraint } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { AdvancedEditor } from './AdvancedEditor';
import { GroupedView } from './GroupedView';
import { NormalizationHint } from './NormalizationHint';
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

  // Quick-add form on top — defaults that work for the common case (any sign,
  // word mode, priority 0). The "+ ajouter à la catégorie" buttons in the
  // grouped view reuse these defaults.
  const [keyword, setKeyword] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [signConstraint, setSignConstraint] = useState<SignConstraint>('any');
  const [matchMode, setMatchMode] = useState<MatchMode>('word');
  const [priority, setPriority] = useState(0);

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
      setKeyword('');
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!categoryId || !keyword.trim()) return;
    const keywords = Array.from(
      new Set(keyword.split(',').map((s) => s.trim()).filter(Boolean)),
    );
    if (keywords.length === 0) return;
    createBatch.mutate({ keywords, categoryId, signConstraint, matchMode, priority });
  };

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

      {/* Quick-add form */}
      <form onSubmit={submit} className="surface p-4 md:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
        <div className="lg:col-span-2">
          <label className="label mb-1.5 block">Mot-clé(s)</label>
          <input
            className="input"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="carrefour, leclerc, lidl"
            required
          />
          <NormalizationHint input={keyword} matchMode={matchMode} />
          <div className="text-[11px] text-ink-500 mt-1.5">
            Séparez par des virgules pour créer plusieurs règles d'un coup.
          </div>
        </div>
        <div>
          <label className="label mb-1.5 block">Catégorie</label>
          <select
            className="input"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}
            required
          >
            <option value="">—</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label mb-1.5 block">Signe</label>
          <select className="input" value={signConstraint} onChange={(e) => setSignConstraint(e.target.value as SignConstraint)}>
            <option value="any">Tous</option>
            <option value="negative">Négatif</option>
            <option value="positive">Positif</option>
          </select>
        </div>
        <div>
          <label className="label mb-1.5 block">Mode</label>
          <select className="input" value={matchMode} onChange={(e) => setMatchMode(e.target.value as MatchMode)}>
            <option value="word">Mot entier</option>
            <option value="substring">Sous-chaîne</option>
            <option value="regex">Regex</option>
          </select>
        </div>
        <div>
          <label className="label mb-1.5 block">Priorité</label>
          <input
            type="number"
            className="input font-mono"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-6 flex items-center gap-3">
          <button className="btn-primary" disabled={createBatch.isPending}>
            {createBatch.isPending ? 'Ajout…' : 'Ajouter la règle'}
          </button>
          {createBatch.isSuccess && createBatch.data && (
            <span className="text-xs text-sage-300">
              {createBatch.data} règle{createBatch.data > 1 ? 's' : ''} ajoutée{createBatch.data > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </form>

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

// ---------------------------------------------------------------------------
// Flat (legacy) view — full table with inline editing
// ---------------------------------------------------------------------------

function FlatTable({
  rules,
  cats,
  updateRule,
  onRequestDelete,
}: {
  rules: Rule[];
  cats: Category[];
  updateRule: UseMutationResult<unknown, Error, { id: number; patch: Partial<Rule> }>;
  onRequestDelete: (rule: Rule) => void;
}) {
  return (
    <div className="surface overflow-hidden">
      <div className="table-scroll">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr className="border-b border-ink-800/70">
              <th className="px-4 py-3 label font-normal">Mot-clé</th>
              <th className="px-4 py-3 label font-normal">Catégorie</th>
              <th className="px-4 py-3 label font-normal hidden md:table-cell">Signe</th>
              <th className="px-4 py-3 label font-normal hidden md:table-cell">Mode</th>
              <th className="px-4 py-3 label font-normal text-right">Pr.</th>
              <th className="px-4 py-3 label font-normal">Actif</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-500 display-italic">
                  Aucune règle.
                </td>
              </tr>
            ) : (
              rules.map((r) => (
                <tr key={r.id} className="border-b border-ink-800/40 last:border-0 hover:bg-ink-850/40 transition">
                  <td className="px-4 py-2.5">
                    <input
                      defaultValue={r.keyword}
                      key={`kw-${r.id}-${r.keyword}`}
                      className="input-sm font-mono"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== r.keyword) {
                          updateRule.mutate({ id: r.id, patch: { keyword: v } });
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') (e.target as HTMLInputElement).value = r.keyword;
                      }}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      className="input-sm"
                      value={r.categoryId}
                      onChange={(e) =>
                        updateRule.mutate({ id: r.id, patch: { categoryId: Number(e.target.value) } })
                      }
                    >
                      {cats.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <select
                      className="input-sm"
                      value={r.signConstraint}
                      onChange={(e) =>
                        updateRule.mutate({
                          id: r.id,
                          patch: { signConstraint: e.target.value as SignConstraint },
                        })
                      }
                    >
                      <option value="any">Tous</option>
                      <option value="negative">Négatif</option>
                      <option value="positive">Positif</option>
                    </select>
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <select
                      className="input-sm"
                      value={r.matchMode}
                      onChange={(e) =>
                        updateRule.mutate({
                          id: r.id,
                          patch: { matchMode: e.target.value as MatchMode },
                        })
                      }
                    >
                      <option value="word">Mot entier</option>
                      <option value="substring">Sous-chaîne</option>
                      <option value="regex">Regex</option>
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <input
                      type="number"
                      defaultValue={r.priority}
                      key={`pri-${r.id}-${r.priority}`}
                      className="input-sm font-mono text-right w-16 ml-auto"
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isInteger(v) && v >= 0 && v !== r.priority) {
                          updateRule.mutate({ id: r.id, patch: { priority: v } });
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) =>
                        updateRule.mutate({ id: r.id, patch: { enabled: e.target.checked } })
                      }
                      className="h-4 w-4 rounded border-ink-700 bg-ink-900 accent-sage-300"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      className="text-[11px] text-ink-500 hover:text-clay-300 transition"
                      onClick={() => onRequestDelete(r)}
                    >
                      supprimer
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
