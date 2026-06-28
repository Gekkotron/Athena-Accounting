import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Category, TriGroup } from '../api/types';
import { formatAmount, formatDate, amountSignClass } from '../lib/format';

export function Tri() {
  const qc = useQueryClient();
  const groupsQ = useQuery({
    queryKey: ['tri-groups'],
    queryFn: () =>
      api<{
        groups: TriGroup[];
        pagination: { total: number; limit: number; offset: number };
      }>('/api/tri/groups', { query: { limit: 200, offset: 0 } }),
  });
  const categoriesQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [perGroupCategory, setPerGroupCategory] = useState<Map<string, number>>(new Map());
  const [bulkCategoryId, setBulkCategoryId] = useState<number | ''>('');
  const [createRules, setCreateRules] = useState(true);

  const groups = groupsQ.data?.groups ?? [];
  const total = groupsQ.data?.pagination.total ?? groups.length;
  const categories = categoriesQ.data?.categories ?? [];

  const toggle = (label: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(groups.map((g) => g.normalized_label)));
  const clearSel = () => setSelected(new Set());

  const setGroupCat = (label: string, categoryId: number) =>
    setPerGroupCategory((m) => {
      const next = new Map(m);
      next.set(label, categoryId);
      return next;
    });

  const assign = useMutation({
    mutationFn: (input: {
      groups: { normalizedLabel: string; categoryId: number }[];
      createRules: boolean;
    }) => api<{ assigned: number; rulesCreated: number }>('/api/tri/assign', { method: 'POST', json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tri-groups'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['rules'] });
      setSelected(new Set());
      setPerGroupCategory(new Map());
    },
  });

  const recategorize = useMutation({
    mutationFn: () =>
      api<{ total: number; recategorized: number; unknown: number; preserved: number }>(
        '/api/recategorize',
        { method: 'POST', json: { preserveManual: true } },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tri-groups'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  const assignSingle = (label: string) => {
    const categoryId = perGroupCategory.get(label);
    if (!categoryId) return;
    assign.mutate({
      groups: [{ normalizedLabel: label, categoryId }],
      createRules,
    });
  };

  const assignBulk = () => {
    if (!bulkCategoryId || selected.size === 0) return;
    const groupsToAssign = Array.from(selected).map((normalizedLabel) => ({
      normalizedLabel,
      categoryId: bulkCategoryId as number,
    }));
    assign.mutate({ groups: groupsToAssign, createRules });
  };

  const processed = groups.filter(
    (g) => perGroupCategory.has(g.normalized_label) || selected.has(g.normalized_label),
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tri des catégories</h1>
          <p className="text-sm text-slate-500">
            {processed} / {total} groupe(s) en cours de traitement — triés par fréquence.
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

      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="label">Catégorie pour la sélection</label>
          <select
            className="input w-56"
            value={bulkCategoryId}
            onChange={(e) => setBulkCategoryId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={createRules}
            onChange={(e) => setCreateRules(e.target.checked)}
            className="h-4 w-4 rounded border-slate-700 bg-slate-900"
          />
          Créer une règle pour chaque libellé
        </label>
        <button
          className="btn-primary"
          onClick={assignBulk}
          disabled={!bulkCategoryId || selected.size === 0 || assign.isPending}
        >
          Appliquer à {selected.size} groupe(s)
        </button>
        <button className="btn-ghost ml-auto" onClick={selectAll} disabled={groups.length === 0}>
          Tout sélectionner
        </button>
        <button className="btn-ghost" onClick={clearSel} disabled={selected.size === 0}>
          Effacer
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr className="border-b border-slate-800 text-slate-500 text-xs uppercase tracking-wider">
              <th className="px-4 py-3 font-normal w-8"></th>
              <th className="px-4 py-3 font-normal">Libellé normalisé</th>
              <th className="px-4 py-3 font-normal">Exemple brut</th>
              <th className="px-4 py-3 font-normal text-right">Nombre</th>
              <th className="px-4 py-3 font-normal text-right">Total</th>
              <th className="px-4 py-3 font-normal">Période</th>
              <th className="px-4 py-3 font-normal">Catégorie</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                  {groupsQ.isLoading
                    ? 'Chargement…'
                    : 'Aucun groupe à trier — toutes les transactions sont catégorisées.'}
                </td>
              </tr>
            ) : (
              groups.map((g) => {
                const selectedG = selected.has(g.normalized_label);
                const localCat = perGroupCategory.get(g.normalized_label);
                return (
                  <tr key={g.normalized_label} className={`border-b border-slate-900 last:border-0 ${selectedG ? 'bg-emerald-950/20' : ''}`}>
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        checked={selectedG}
                        onChange={() => toggle(g.normalized_label)}
                        className="h-4 w-4 rounded border-slate-700 bg-slate-900"
                      />
                    </td>
                    <td className="px-4 py-2 text-slate-200 font-mono text-xs">{g.normalized_label}</td>
                    <td className="px-4 py-2 text-slate-400 text-xs truncate max-w-xs" title={g.example_raw_label}>
                      {g.example_raw_label}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-300">{g.transaction_count}</td>
                    <td className={`px-4 py-2 text-right font-mono ${amountSignClass(g.total_amount)}`}>
                      {formatAmount(g.total_amount, 'EUR')}
                    </td>
                    <td className="px-4 py-2 text-slate-500 text-xs whitespace-nowrap">
                      {formatDate(g.min_date)} → {formatDate(g.max_date)}
                    </td>
                    <td className="px-4 py-2">
                      <select
                        className="input py-1 text-xs"
                        value={localCat ?? ''}
                        onChange={(e) =>
                          e.target.value
                            ? setGroupCat(g.normalized_label, Number(e.target.value))
                            : setPerGroupCategory((m) => {
                                const next = new Map(m);
                                next.delete(g.normalized_label);
                                return next;
                              })
                        }
                      >
                        <option value="">—</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        className="text-xs text-emerald-300 hover:text-emerald-200 disabled:opacity-40"
                        disabled={!localCat || assign.isPending}
                        onClick={() => assignSingle(g.normalized_label)}
                      >
                        Appliquer
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
