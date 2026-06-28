import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Category, MatchMode, Rule, SignConstraint } from '../api/types';
import { normalizeLabel } from '../lib/normalize';

const SIGN_LABEL: Record<SignConstraint, string> = {
  positive: 'Positif',
  negative: 'Négatif',
  any: 'Tous',
};
const MATCH_LABEL: Record<MatchMode, string> = {
  word: 'Mot entier',
  substring: 'Sous-chaîne',
  regex: 'Regex',
};

type View = 'grouped' | 'flat';

interface GroupedEntry {
  category: Category;
  rules: Rule[];
}

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
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
          onClick={() => recategorize.mutate()}
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
          del={del}
          onEdit={setEditing}
        />
      ) : (
        <FlatTable
          rules={rules}
          cats={cats}
          updateRule={updateRule}
          del={del}
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
            if (confirm(`Supprimer la règle « ${editing.keyword} » ?`)) {
              del.mutate(editing.id, { onSuccess: () => setEditing(null) });
            }
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grouped view
// ---------------------------------------------------------------------------

function GroupedView({
  grouped,
  createBatch,
  updateRule,
  del,
  onEdit,
}: {
  grouped: GroupedEntry[];
  createBatch: UseMutationResult<
    number,
    Error,
    {
      keywords: string[];
      categoryId: number;
      signConstraint: SignConstraint;
      matchMode: MatchMode;
      priority: number;
    }
  >;
  updateRule: UseMutationResult<unknown, Error, { id: number; patch: Partial<Rule> }>;
  del: UseMutationResult<unknown, Error, number>;
  onEdit: (rule: Rule) => void;
}) {
  if (grouped.length === 0) {
    return (
      <div className="surface p-8 text-center text-ink-500 display-italic">
        Aucune catégorie. Créez-en une dans l'onglet « Catégories ».
      </div>
    );
  }

  return (
    <div className="surface overflow-hidden">
      <div className="divide-y divide-ink-800/60">
        {grouped.map((g) => (
          <CategoryRow
            key={g.category.id}
            group={g}
            createBatch={createBatch}
            updateRule={updateRule}
            del={del}
            onEdit={onEdit}
          />
        ))}
      </div>
    </div>
  );
}

function CategoryRow({
  group,
  createBatch,
  updateRule,
  del,
  onEdit,
}: {
  group: GroupedEntry;
  createBatch: UseMutationResult<
    number,
    Error,
    {
      keywords: string[];
      categoryId: number;
      signConstraint: SignConstraint;
      matchMode: MatchMode;
      priority: number;
    }
  >;
  updateRule: UseMutationResult<unknown, Error, { id: number; patch: Partial<Rule> }>;
  del: UseMutationResult<unknown, Error, number>;
  onEdit: (rule: Rule) => void;
}) {
  const { category, rules } = group;
  const hasEnabled = rules.some((r) => r.enabled);
  const hasDisabled = rules.some((r) => !r.enabled);

  const defaultSign: SignConstraint =
    category.kind === 'expense' ? 'negative' : category.kind === 'income' ? 'positive' : 'any';

  const setEnabledAll = (enabled: boolean) => {
    for (const r of rules) {
      if (r.enabled !== enabled) updateRule.mutate({ id: r.id, patch: { enabled } });
    }
  };

  return (
    <div className="px-4 py-4 md:px-5 flex flex-col gap-3 md:flex-row md:items-start md:gap-5">
      {/* Category header */}
      <div className="md:w-48 shrink-0">
        <div className="flex items-center gap-2">
          {category.color && (
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: category.color }}
            />
          )}
          <span className="font-medium text-ink-100 truncate">{category.name}</span>
        </div>
        <div className="text-[11px] text-ink-500 mt-0.5">
          {KIND_FR[category.kind]} ·{' '}
          <span className="font-mono">
            {rules.length} mot{rules.length > 1 ? 's' : ''}-clé{rules.length > 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Chips */}
      <div className="flex-1 flex flex-wrap items-center gap-1.5 min-w-0">
        {rules.length === 0 ? (
          <span className="text-[11px] text-ink-600 display-italic">aucun mot-clé</span>
        ) : (
          rules.map((r) => (
            <Chip
              key={r.id}
              rule={r}
              onToggle={() => updateRule.mutate({ id: r.id, patch: { enabled: !r.enabled } })}
              onAdvanced={() => onEdit(r)}
              onDelete={() => {
                if (confirm(`Supprimer la règle « ${r.keyword} » ?`)) del.mutate(r.id);
              }}
            />
          ))
        )}
        <AddChipInput
          onAdd={(keywords) => {
            createBatch.mutate({
              keywords,
              categoryId: category.id,
              signConstraint: defaultSign,
              matchMode: 'word',
              priority: 0,
            });
          }}
        />
      </div>

      {/* Bulk actions */}
      <div className="flex flex-wrap gap-3 md:gap-2 md:flex-col md:items-end shrink-0 text-[11px]">
        {hasEnabled && (
          <button
            className="text-ink-500 hover:text-ink-100 transition whitespace-nowrap"
            onClick={() => setEnabledAll(false)}
          >
            désactiver tout
          </button>
        )}
        {hasDisabled && (
          <button
            className="text-ink-500 hover:text-ink-100 transition whitespace-nowrap"
            onClick={() => setEnabledAll(true)}
          >
            tout activer
          </button>
        )}
      </div>
    </div>
  );
}

// Shows what the matcher will *actually* search for, given the normalisation
// applied to both rule keywords and transaction labels. Helps users avoid
// the trap of typing prefixes like "VIR " or "CB " that get stripped.
function NormalizationHint({
  input,
  matchMode,
}: {
  input: string;
  matchMode: MatchMode;
}) {
  // Regex mode is a deliberate pattern — we don't pre-normalize it.
  if (matchMode === 'regex' || !input.trim()) return null;

  const parts = input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const transformed = parts.map((p) => ({ raw: p, norm: normalizeLabel(p) }));
  const anyChange = transformed.some(
    (t) => t.norm !== t.raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''),
  );
  const anyEmpty = transformed.some((t) => !t.norm);

  if (!anyChange && !anyEmpty) return null;

  return (
    <div className="text-[11px] mt-1.5 leading-relaxed">
      {anyEmpty && (
        <div className="text-clay-300">
          ⚠️ Au moins un mot-clé devient vide après normalisation (préfixe ou date pur) — il ne matchera rien.
        </div>
      )}
      {anyChange && (
        <div className="text-ink-500">
          Sera matché comme :{' '}
          {transformed.map((t, i) => (
            <span key={i}>
              <span className={`font-mono ${t.norm ? 'text-sage-300' : 'text-clay-300 line-through'}`}>
                {t.norm || t.raw}
              </span>
              {i < transformed.length - 1 ? ', ' : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const KIND_FR: Record<Category['kind'], string> = {
  expense: 'Dépense',
  income: 'Revenu',
  transfer: 'Virement',
  neutral: 'Neutre',
};

function Chip({
  rule,
  onToggle,
  onAdvanced,
  onDelete,
}: {
  rule: Rule;
  onToggle: () => void;
  onAdvanced: () => void;
  onDelete: () => void;
}) {
  const tooltip = `Priorité ${rule.priority} · ${SIGN_LABEL[rule.signConstraint]} · ${MATCH_LABEL[rule.matchMode]}${rule.enabled ? '' : ' · désactivée'}`;
  return (
    <span
      className={`group inline-flex items-center gap-1 rounded-full border pl-2.5 pr-1 py-0.5 text-xs font-mono transition ${
        rule.enabled
          ? 'border-sage-800/40 bg-sage-900/20 text-sage-200 hover:border-sage-700/60'
          : 'border-ink-800 bg-ink-900 text-ink-500 line-through hover:text-ink-300'
      }`}
      title={tooltip}
    >
      <button onClick={onToggle} className="py-0.5">
        {rule.keyword}
      </button>
      <button
        onClick={onAdvanced}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-ink-400 hover:text-ink-100 transition px-0.5"
        aria-label="Modifier"
        title="Modifier (priorité, signe, mode)"
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
          <path d="M2 7.5l5-5 1.5 1.5-5 5L2 9.5V7.5z" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-ink-400 hover:text-clay-300 transition px-0.5 mr-0.5"
        aria-label="Supprimer"
        title="Supprimer"
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
          <path d="M2 2l7 7M9 2L2 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
    </span>
  );
}

function AddChipInput({ onAdd }: { onAdd: (keywords: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-ink-700 text-ink-500 hover:text-ink-100 hover:border-ink-600 px-2.5 py-0.5 text-xs transition"
      >
        + ajouter
      </button>
    );
  }

  const commit = () => {
    const keywords = Array.from(
      new Set(value.split(',').map((s) => s.trim()).filter(Boolean)),
    );
    if (keywords.length > 0) onAdd(keywords);
    setValue('');
    setOpen(false);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
      className="inline-flex items-center"
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value.trim()) commit();
          else setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setValue('');
            setOpen(false);
          }
        }}
        placeholder="dentiste, pharma…"
        className="rounded-full border border-ink-700 bg-ink-900 px-2.5 py-0.5 text-xs font-mono text-ink-100 placeholder:text-ink-600 focus:border-sage-300/50 w-44"
      />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Advanced editor modal
// ---------------------------------------------------------------------------

function AdvancedEditor({
  rule,
  categories,
  onClose,
  onSave,
  onDelete,
}: {
  rule: Rule;
  categories: Category[];
  onClose: () => void;
  onSave: (patch: Partial<Rule>) => void;
  onDelete: () => void;
}) {
  const [keyword, setKeyword] = useState(rule.keyword);
  const [categoryId, setCategoryId] = useState(rule.categoryId);
  const [signConstraint, setSignConstraint] = useState<SignConstraint>(rule.signConstraint);
  const [matchMode, setMatchMode] = useState<MatchMode>(rule.matchMode);
  const [priority, setPriority] = useState(rule.priority);
  const [enabled, setEnabled] = useState(rule.enabled);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const patch: Partial<Rule> = {};
    if (keyword.trim() && keyword.trim() !== rule.keyword) patch.keyword = keyword.trim();
    if (categoryId !== rule.categoryId) patch.categoryId = categoryId;
    if (signConstraint !== rule.signConstraint) patch.signConstraint = signConstraint;
    if (matchMode !== rule.matchMode) patch.matchMode = matchMode;
    if (priority !== rule.priority) patch.priority = priority;
    if (enabled !== rule.enabled) patch.enabled = enabled;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    onSave(patch);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-ink-950/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="surface w-full max-w-md p-6"
      >
        <div className="mb-4">
          <div className="label mb-1">Règle</div>
          <div className="font-mono text-sm text-ink-100 truncate">{rule.keyword}</div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="label mb-1.5 block">Mot-clé</label>
            <input
              className="input font-mono"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label mb-1.5 block">Catégorie</label>
            <select
              className="input"
              value={categoryId}
              onChange={(e) => setCategoryId(Number(e.target.value))}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label mb-1.5 block">Signe</label>
            <select
              className="input"
              value={signConstraint}
              onChange={(e) => setSignConstraint(e.target.value as SignConstraint)}
            >
              <option value="any">Tous</option>
              <option value="negative">Négatif</option>
              <option value="positive">Positif</option>
            </select>
          </div>
          <div>
            <label className="label mb-1.5 block">Mode</label>
            <select
              className="input"
              value={matchMode}
              onChange={(e) => setMatchMode(e.target.value as MatchMode)}
            >
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
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-ink-200 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-ink-700 bg-ink-900 accent-sage-300"
              />
              Activée
            </label>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 mt-6 pt-4 border-t border-ink-800/60">
          <button
            type="button"
            onClick={onDelete}
            className="text-xs text-clay-300 hover:text-clay-200 transition"
          >
            Supprimer
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              Enregistrer
            </button>
          </div>
        </div>
      </form>
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
  del,
}: {
  rules: Rule[];
  cats: Category[];
  updateRule: UseMutationResult<unknown, Error, { id: number; patch: Partial<Rule> }>;
  del: UseMutationResult<unknown, Error, number>;
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
                      onClick={() => {
                        if (confirm(`Supprimer la règle « ${r.keyword} » ?`)) del.mutate(r.id);
                      }}
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
