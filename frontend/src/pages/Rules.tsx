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
    create.mutate({
      keyword: keyword.trim(),
      categoryId,
      signConstraint,
      matchMode,
      priority,
    });
  };

  const cats = catQ.data?.categories ?? [];
  const rules = rulesQ.data?.rules ?? [];
  const catName = (id: number) => cats.find((c) => c.id === id)?.name ?? `#${id}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Règles</h1>
          <p className="text-sm text-slate-500">
            Le matcher est insensible aux accents/casse. « Mot entier » empêche « paye » de matcher « payweb ».
          </p>
        </div>
        <button
          className="btn-secondary"
          onClick={() => recategorize.mutate()}
          disabled={recategorize.isPending}
        >
          {recategorize.isPending ? 'Recatégorisation…' : 'Recatégoriser tout l\'historique'}
        </button>
      </div>

      {recategorize.data && (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
          Total : {recategorize.data.total} · Recatégorisées : {recategorize.data.recategorized} ·
          Inconnues : {recategorize.data.unknown} · Manuelles préservées : {recategorize.data.preserved}
        </div>
      )}

      <form onSubmit={submit} className="card p-4 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
        <div className="md:col-span-2">
          <label className="label">Mot-clé</label>
          <input
            className="input w-full"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="carrefour"
            required
          />
        </div>
        <div>
          <label className="label">Catégorie</label>
          <select
            className="input w-full"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}
            required
          >
            <option value="">—</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Signe</label>
          <select
            className="input w-full"
            value={signConstraint}
            onChange={(e) => setSignConstraint(e.target.value as SignConstraint)}
          >
            <option value="any">Tous</option>
            <option value="negative">Négatif (dépense)</option>
            <option value="positive">Positif (revenu)</option>
          </select>
        </div>
        <div>
          <label className="label">Mode</label>
          <select
            className="input w-full"
            value={matchMode}
            onChange={(e) => setMatchMode(e.target.value as MatchMode)}
          >
            <option value="word">Mot entier</option>
            <option value="substring">Sous-chaîne</option>
            <option value="regex">Regex</option>
          </select>
        </div>
        <div>
          <label className="label">Priorité</label>
          <input
            type="number"
            className="input w-full"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
          />
        </div>
        <div className="md:col-span-6">
          <button className="btn-primary">Ajouter la règle</button>
        </div>
      </form>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr className="border-b border-slate-800 text-slate-500 text-xs uppercase tracking-wider">
              <th className="px-4 py-3 font-normal">Mot-clé</th>
              <th className="px-4 py-3 font-normal">Catégorie</th>
              <th className="px-4 py-3 font-normal">Signe</th>
              <th className="px-4 py-3 font-normal">Mode</th>
              <th className="px-4 py-3 font-normal text-right">Priorité</th>
              <th className="px-4 py-3 font-normal">Activée</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  Aucune règle pour l'instant — ajoutez-en ou utilisez « Tri » pour en générer.
                </td>
              </tr>
            ) : (
              rules.map((r) => (
                <tr key={r.id} className="border-b border-slate-900 last:border-0">
                  <td className="px-4 py-2 text-slate-200 font-mono text-xs">{r.keyword}</td>
                  <td className="px-4 py-2 text-slate-300">{catName(r.categoryId)}</td>
                  <td className="px-4 py-2 text-slate-400">{SIGN_LABEL[r.signConstraint]}</td>
                  <td className="px-4 py-2 text-slate-400">{MATCH_LABEL[r.matchMode]}</td>
                  <td className="px-4 py-2 text-right text-slate-400">{r.priority}</td>
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) => toggleEnabled.mutate({ id: r.id, enabled: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-700 bg-slate-900"
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      className="text-xs text-rose-300 hover:text-rose-200"
                      onClick={() => {
                        if (confirm(`Supprimer la règle « ${r.keyword} » ?`)) del.mutate(r.id);
                      }}
                    >
                      Supprimer
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
