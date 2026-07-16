import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Category, MatchMode, SignConstraint } from '../../api/types';
import { formatCategoryPath } from '../../lib/categories';
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
  const { t } = useTranslation('rules');
  // Quick-add form on top — defaults that work for the common case (any sign,
  // word mode, priority 0). The "+ ajouter à la catégorie" buttons in the
  // grouped view reuse these defaults.
  const [keyword, setKeyword] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [signConstraint, setSignConstraint] = useState<SignConstraint>('any');
  const [matchMode, setMatchMode] = useState<MatchMode>('word');
  const [priority, setPriority] = useState(0);
  const byId = useMemo(
    () => new Map(categories.map((c) => [c.id, c] as const)),
    [categories],
  );

  // Preserve the pre-extraction "clear only on success" semantic:
  // setKeyword('') originally lived in createBatch.onSuccess (index.tsx).
  // After extraction, watch the parent's successCount prop (which only
  // increments on success) and reset the keyword when it changes.
  useEffect(() => {
    if (successCount != null && successCount > 0) {
      setKeyword('');
    }
  }, [successCount]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!categoryId || !keyword.trim()) return;
    const keywords = Array.from(
      new Set(keyword.split(',').map((s) => s.trim()).filter(Boolean)),
    );
    if (keywords.length === 0) return;
    onSubmit({ keywords, categoryId, signConstraint, matchMode, priority });
  };

  return (
    <form onSubmit={submit} className="surface p-4 md:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
      <div className="lg:col-span-2">
        <label className="label mb-1.5 block">{t('ruleCreateForm.keywordLabel')}</label>
        <input
          className="input"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="carrefour, leclerc, lidl"
          required
        />
        <NormalizationHint input={keyword} matchMode={matchMode} />
        <div className="text-[11px] text-ink-500 mt-1.5">
          {t('ruleCreateForm.keywordHelp')}
        </div>
      </div>
      <div>
        <label className="label mb-1.5 block">{t('ruleCreateForm.categoryLabel')}</label>
        <select
          className="input"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}
          required
        >
          <option value="">—</option>
          {[...categories]
            .sort((a, b) => {
              const pa = a.parentId != null ? byId.get(a.parentId)?.name ?? '' : a.name;
              const pb = b.parentId != null ? byId.get(b.parentId)?.name ?? '' : b.name;
              return pa.localeCompare(pb) || a.name.localeCompare(b.name);
            })
            .map((c) => (
              <option key={c.id} value={c.id}>{formatCategoryPath(c, byId)}</option>
            ))}
        </select>
      </div>
      <div>
        <label className="label mb-1.5 block">{t('ruleCreateForm.signLabel')}</label>
        <select className="input" value={signConstraint} onChange={(e) => setSignConstraint(e.target.value as SignConstraint)}>
          <option value="any">{t('signOptions.any')}</option>
          <option value="negative">{t('signOptions.negative')}</option>
          <option value="positive">{t('signOptions.positive')}</option>
        </select>
      </div>
      <div>
        <label className="label mb-1.5 block">{t('ruleCreateForm.modeLabel')}</label>
        <select className="input" value={matchMode} onChange={(e) => setMatchMode(e.target.value as MatchMode)}>
          <option value="word">{t('matchModeOptions.word')}</option>
          <option value="substring">{t('matchModeOptions.substring')}</option>
          <option value="regex">{t('matchModeOptions.regex')}</option>
        </select>
      </div>
      <div>
        <label className="label mb-1.5 block">{t('ruleCreateForm.priorityLabel')}</label>
        <input
          inputMode="numeric"
          className="input font-mono"
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
        />
      </div>
      <div className="sm:col-span-2 lg:col-span-6 flex items-center gap-3">
        <button className="btn-primary" disabled={submitting}>
          {submitting ? t('ruleCreateForm.submitPending') : t('ruleCreateForm.submit')}
        </button>
        {successCount != null && successCount > 0 && (
          <span className="text-xs text-sage-300">
            {t('ruleCreateForm.successCount', { count: successCount })}
          </span>
        )}
      </div>
    </form>
  );
}
