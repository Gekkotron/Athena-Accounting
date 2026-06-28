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

  const totalsByCat = new Map<number | null, number>();
  for (const r of report) {
    const prev = totalsByCat.get(r.category_id) ?? 0;
    totalsByCat.set(r.category_id, prev + Number(r.total));
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="page-title">Catégories</h1>
        <p className="page-subtitle max-w-2xl">
          Le <span className="display-italic">« kind »</span> alimente le garde-fou de signe :
          une catégorie « Revenu » ne s'applique jamais à un montant négatif.
        </p>
      </div>

      <form onSubmit={submit} className="surface p-4 md:p-5 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="label mb-1.5 block">Nom</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="w-full sm:w-40">
          <label className="label mb-1.5 block">Type</label>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)}>
            <option value="expense">Dépense</option>
            <option value="income">Revenu</option>
            <option value="transfer">Virement</option>
            <option value="neutral">Neutre</option>
          </select>
        </div>
        <div className="w-full sm:w-32">
          <label className="label mb-1.5 block">Couleur</label>
          <input
            className="input font-mono"
            value={color}
            placeholder="#7dd3c0"
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        <button className="btn-primary" disabled={create.isPending}>Ajouter</button>
        {error && <div className="text-sm text-clay-300 w-full">{error}</div>}
      </form>

      <div className="surface overflow-hidden">
        <div className="table-scroll">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="border-b border-ink-800/70">
                <th className="px-4 py-3 label font-normal">Nom</th>
                <th className="px-4 py-3 label font-normal">Type</th>
                <th className="px-4 py-3 label font-normal hidden sm:table-cell">Couleur</th>
                <th className="px-4 py-3 label font-normal text-right">Total (période chargée)</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {cats.map((c) => {
                const t = totalsByCat.get(c.id) ?? 0;
                return (
                  <tr key={c.id} className="border-b border-ink-800/40 last:border-0 hover:bg-ink-850/40 transition">
                    <td className="px-4 py-2.5 text-ink-100">
                      <span className="flex items-center gap-2">
                        {c.color && (
                          <span
                            className="h-2 w-2 rounded-full border border-ink-700"
                            style={{ backgroundColor: c.color }}
                          />
                        )}
                        {c.name}
                        {c.isDefault && <span className="badge ml-1">défaut</span>}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-ink-300">{KIND_LABEL[c.kind]}</td>
                    <td className="px-4 py-2.5 hidden sm:table-cell">
                      {c.color ? (
                        <span className="font-mono text-xs text-ink-400">{c.color}</span>
                      ) : (
                        <span className="text-ink-600">—</span>
                      )}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono tabular-nums ${t < 0 ? 'text-clay-300' : t > 0 ? 'text-sage-300' : 'text-ink-500'}`}>
                      {formatAmount(t)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {!c.isDefault && (
                        <button
                          className="text-[11px] text-ink-500 hover:text-clay-300 transition"
                          onClick={() => {
                            if (confirm(`Supprimer la catégorie « ${c.name} » ?`)) del.mutate(c.id);
                          }}
                        >
                          supprimer
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
    </div>
  );
}
