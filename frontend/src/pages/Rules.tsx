import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Category, MatchMode, Rule, SignConstraint } from '../api/types';

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

  const [keyword, setKeyword] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [signConstraint, setSignConstraint] = useState<SignConstraint>('any');
  const [matchMode, setMatchMode] = useState<MatchMode>('word');
  const [priority, setPriority] = useState(0);

  // Accepts an array of keywords and creates one rule per keyword, sharing
  // the same category / sign / mode / priority. The DB model is one keyword
  // per row — this hook just spares the user from clicking "Add" N times.
  const createBatch = useMutation({
    mutationFn: async (input: {
      keywords: string[];
      categoryId: number;
      signConstraint: SignConstraint;
      matchMode: MatchMode;
      priority: number;
    }) => {
      await Promise.all(
        input.keywords.map((keyword) =>
          api('/api/rules', {
            method: 'POST',
            json: {
              keyword,
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
          <div className="text-[11px] text-ink-500 mt-1.5">
            Séparez par des virgules pour créer plusieurs règles d'un coup, toutes vers la même catégorie.
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
                    Aucune règle — ajoutez-en ou utilisez « Tri ».
                  </td>
                </tr>
              ) : (
                rules.map((r) => (
                  <tr key={r.id} className="border-b border-ink-800/40 last:border-0 hover:bg-ink-850/40 transition">
                    <td className="px-4 py-2.5">
                      <input
                        defaultValue={r.keyword}
                        // Remount the input when the server-side value changes so
                        // defaultValue stays in sync after a save.
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
                          updateRule.mutate({
                            id: r.id,
                            patch: { categoryId: Number(e.target.value) },
                          })
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
    </div>
  );
}
