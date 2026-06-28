import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Category, CategoryKind, CategoryReportRow } from '../api/types';
import { formatAmount } from '../lib/format';

const KIND_LABEL: Record<CategoryKind, string> = {
  expense: 'Dépense',
  income: 'Revenu',
  transfer: 'Virement',
  neutral: 'Neutre',
};

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
    mutationFn: (input: { name: string; kind: CategoryKind; color: string | null }) =>
      api<{ category: Category }>('/api/categories', { method: 'POST', json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      setName('');
      setColor('');
    },
    onError: (err: ApiError) => setError(err.message),
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/api/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate({ name: name.trim(), kind, color: color || null });
  };

  const cats = catQ.data?.categories ?? [];
  const report = reportQ.data?.rows ?? [];

  // Aggregate totals per category over the loaded report range.
  const totalsByCat = new Map<number | null, number>();
  for (const r of report) {
    const prev = totalsByCat.get(r.category_id) ?? 0;
    totalsByCat.set(r.category_id, prev + Number(r.total));
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Catégories</h1>
        <p className="text-sm text-slate-500">
          Le « kind » alimente le garde-fou de signe : une catégorie « Revenu » ne s'applique jamais à un montant négatif.
        </p>
      </div>

      <form onSubmit={submit} className="card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Nom</label>
          <input className="input w-56" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label">Type</label>
          <select className="input w-40" value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)}>
            <option value="expense">Dépense</option>
            <option value="income">Revenu</option>
            <option value="transfer">Virement</option>
            <option value="neutral">Neutre</option>
          </select>
        </div>
        <div>
          <label className="label">Couleur (optionnel)</label>
          <input
            className="input w-32 font-mono"
            value={color}
            placeholder="#34d399"
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        <button className="btn-primary" disabled={create.isPending}>
          Ajouter
        </button>
        {error && <div className="text-sm text-rose-300 ml-2">{error}</div>}
      </form>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr className="border-b border-slate-800 text-slate-500 text-xs uppercase tracking-wider">
              <th className="px-4 py-3 font-normal">Nom</th>
              <th className="px-4 py-3 font-normal">Type</th>
              <th className="px-4 py-3 font-normal">Couleur</th>
              <th className="px-4 py-3 font-normal text-right">Total (sur période chargée)</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {cats.map((c) => {
              const t = totalsByCat.get(c.id) ?? 0;
              return (
                <tr key={c.id} className="border-b border-slate-900 last:border-0">
                  <td className="px-4 py-3 text-slate-200">
                    {c.name}
                    {c.isDefault && <span className="badge ml-2 text-[10px] py-0">défaut</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{KIND_LABEL[c.kind]}</td>
                  <td className="px-4 py-3">
                    {c.color ? (
                      <span
                        className="inline-block h-3 w-3 rounded-sm border border-slate-700"
                        style={{ backgroundColor: c.color }}
                      />
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono ${t < 0 ? 'text-rose-300' : t > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {formatAmount(t)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!c.isDefault && (
                      <button
                        className="text-xs text-rose-300 hover:text-rose-200"
                        onClick={() => {
                          if (confirm(`Supprimer la catégorie « ${c.name} » ?`)) del.mutate(c.id);
                        }}
                      >
                        Supprimer
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
