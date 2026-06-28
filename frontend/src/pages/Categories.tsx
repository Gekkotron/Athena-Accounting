import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Category, CategoryKind, CategoryReportRow } from '../api/types';
import { formatAmount } from '../lib/format';
import { CategoryBreakdown } from '../components/CategoryBreakdown';

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
  const updateCategory = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Category> }) =>
      api(`/api/categories/${id}`, { method: 'PUT', json: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
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

      <section className="surface p-5 md:p-6">
        <div className="section-rule mb-4">Répartition par catégorie</div>
        <CategoryBreakdown defaultRange="3m" />
      </section>

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
                    {/* Name — editable inline */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {c.color && (
                          <span
                            className="h-2 w-2 rounded-full border border-ink-700 shrink-0"
                            style={{ backgroundColor: c.color }}
                          />
                        )}
                        <input
                          defaultValue={c.name}
                          key={`name-${c.id}-${c.name}`}
                          className="input-sm flex-1 min-w-0"
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v && v !== c.name) {
                              updateCategory.mutate({ id: c.id, patch: { name: v } });
                            } else if (!v) {
                              e.target.value = c.name;
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            if (e.key === 'Escape') (e.target as HTMLInputElement).value = c.name;
                          }}
                        />
                        {c.isDefault && <span className="badge ml-1 shrink-0">défaut</span>}
                      </div>
                    </td>
                    {/* Kind — editable */}
                    <td className="px-4 py-2.5">
                      <select
                        className="input-sm"
                        value={c.kind}
                        onChange={(e) =>
                          updateCategory.mutate({
                            id: c.id,
                            patch: { kind: e.target.value as CategoryKind },
                          })
                        }
                      >
                        <option value="expense">Dépense</option>
                        <option value="income">Revenu</option>
                        <option value="transfer">Virement</option>
                        <option value="neutral">Neutre</option>
                      </select>
                    </td>
                    {/* Color — editable */}
                    <td className="px-4 py-2.5 hidden sm:table-cell">
                      <input
                        type="text"
                        defaultValue={c.color ?? ''}
                        key={`color-${c.id}-${c.color ?? ''}`}
                        placeholder="#7dd3c0"
                        className="input-sm font-mono w-28"
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          if (raw === '') {
                            if (c.color !== null) {
                              updateCategory.mutate({ id: c.id, patch: { color: null } });
                            }
                          } else if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(raw)) {
                            if (raw !== c.color) {
                              updateCategory.mutate({ id: c.id, patch: { color: raw } });
                            }
                          } else {
                            e.target.value = c.color ?? '';
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') (e.target as HTMLInputElement).value = c.color ?? '';
                        }}
                      />
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
