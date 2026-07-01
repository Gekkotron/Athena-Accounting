import { useState, type FormEvent } from 'react';
import type { Category, MatchMode, SignConstraint } from '../../api/types';
import { NormalizationHint } from './NormalizationHint';

export function RuleCreateForm({
  categories,
  onSubmit,
  submitting,
  successCount,
}: {
  categories: Category[];
  onSubmit: (values: {
    keywords: string[];
    categoryId: number;
    signConstraint: SignConstraint;
    matchMode: MatchMode;
    priority: number;
  }) => void;
  submitting?: boolean;
  successCount?: number;
}) {
  // Quick-add form on top — defaults that work for the common case (any sign,
  // word mode, priority 0). The "+ ajouter à la catégorie" buttons in the
  // grouped view reuse these defaults.
  const [keyword, setKeyword] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [signConstraint, setSignConstraint] = useState<SignConstraint>('any');
  const [matchMode, setMatchMode] = useState<MatchMode>('word');
  const [priority, setPriority] = useState(0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!categoryId || !keyword.trim()) return;
    const keywords = Array.from(
      new Set(keyword.split(',').map((s) => s.trim()).filter(Boolean)),
    );
    if (keywords.length === 0) return;
    onSubmit({ keywords, categoryId, signConstraint, matchMode, priority });
    setKeyword('');
  };

  return (
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
          {categories.map((c) => (
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
        <button className="btn-primary" disabled={submitting}>
          {submitting ? 'Ajout…' : 'Ajouter la règle'}
        </button>
        {successCount != null && successCount > 0 && (
          <span className="text-xs text-sage-300">
            {successCount} règle{successCount > 1 ? 's' : ''} ajoutée{successCount > 1 ? 's' : ''}
          </span>
        )}
      </div>
    </form>
  );
}
