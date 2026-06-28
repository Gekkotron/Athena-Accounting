import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Category, MatchMode, Rule, SignConstraint } from '../api/types';

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

  const create = useMutation({
    mutationFn: (input: {
      keyword: string;
      categoryId: number;
      signConstraint: SignConstraint;
      matchMode: MatchMode;
      priority: number;
    }) => api('/api/rules', { method: 'POST', json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rules'] });
      setKeyword('');
    },
  });
  const toggleEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      api(`/api/rules/${id}`, { method: 'PUT', json: { enabled } }),
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
    create.mutate({ keyword: keyword.trim(), categoryId, signConstraint, matchMode, priority });
  };

  const cats = catQ.data?.categories ?? [];
  const rules = rulesQ.data?.rules ?? [];
  const catName = (id: number) => cats.find((c) => c.id === id)?.name ?? `#${id}`;

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
          <label className="label mb-1.5 block">Mot-clé</label>
          <input
            className="input"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="carrefour"
            required
          />
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
        <div className="sm:col-span-2 lg:col-span-6">
          <button className="btn-primary">Ajouter la règle</button>
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
                    <td className="px-4 py-2.5 text-ink-100 font-mono text-xs">{r.keyword}</td>
                    <td className="px-4 py-2.5 text-ink-300">{catName(r.categoryId)}</td>
                    <td className="px-4 py-2.5 text-ink-400 hidden md:table-cell">{SIGN_LABEL[r.signConstraint]}</td>
                    <td className="px-4 py-2.5 text-ink-400 hidden md:table-cell">{MATCH_LABEL[r.matchMode]}</td>
                    <td className="px-4 py-2.5 text-right text-ink-400 font-mono">{r.priority}</td>
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) => toggleEnabled.mutate({ id: r.id, enabled: e.target.checked })}
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
