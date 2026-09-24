import { useId, useState, useEffect, useMemo, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { Category, MatchMode, SignConstraint } from '../../api/types';
import { formatCategoryPath } from '../../lib/categories';
import { amountSignClass, formatAmount } from '../../lib/format';
import { NormalizationHint } from './NormalizationHint';
import { RuleSplitEditor, type SplitDraft } from './RuleSplitEditor';

interface PreviewMatch {
  id: number;
  date: string;
  amount: string;
  rawLabel: string;
  accountId: number;
}

interface KeywordPreview {
  keyword: string;
  matches: PreviewMatch[];
  totalCount: number;
}

// Rows shown per keyword — enough to judge over/under-matching at a glance;
// the header count still reflects every match.
const PREVIEW_ROWS_SHOWN = 8;

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
    splits?: Array<{ categoryId: number; percent: number }>;
  }) => void;
  submitting?: boolean;
  successCount?: number;
}) {
  const { t } = useTranslation('rules');
  // Quick-add form on top — defaults that work for the common case (any sign,
  // word mode, priority 0). The "+ ajouter à la catégorie" buttons in the
  // grouped view reuse these defaults.
  const uid = useId();
  const ids = {
    keyword: `${uid}-keyword`,
    category: `${uid}-category`,
    sign: `${uid}-sign`,
    mode: `${uid}-mode`,
    priority: `${uid}-priority`,
  };
  const [keyword, setKeyword] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [signConstraint, setSignConstraint] = useState<SignConstraint>('any');
  const [matchMode, setMatchMode] = useState<MatchMode>('word');
  const [priority, setPriority] = useState(0);
  const [preview, setPreview] = useState<KeywordPreview[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState(false);
  const [splitState, setSplitState] = useState<{ splits: SplitDraft[]; valid: boolean }>({
    splits: [], valid: false,
  });
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

  // A stale preview is worse than none — drop it as soon as any input that
  // feeds the dry run changes.
  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
  }, [keyword, signConstraint, matchMode]);

  const runPreview = async () => {
    const keywords = Array.from(
      new Set(keyword.split(',').map((s) => s.trim()).filter(Boolean)),
    );
    if (keywords.length === 0 || previewing) return;
    setPreviewing(true);
    setPreviewError(null);
    try {
      const results = await Promise.all(
        keywords.map(async (k) => {
          const r = await api<{ matches: PreviewMatch[]; totalCount: number; limit: number }>(
            '/api/rules/preview',
            { method: 'POST', json: { keyword: k, signConstraint, matchMode } },
          );
          return { keyword: k, matches: r.matches, totalCount: r.totalCount };
        }),
      );
      setPreview(results);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewing(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!categoryId || !keyword.trim()) return;
    if (splitMode && !splitState.valid) return;
    const keywords = Array.from(
      new Set(keyword.split(',').map((s) => s.trim()).filter(Boolean)),
    );
    if (keywords.length === 0) return;
    const splitsPayload = splitMode
      ? splitState.splits.map((s) => ({ categoryId: s.categoryId as number, percent: s.percent }))
      : undefined;
    onSubmit({ keywords, categoryId, signConstraint, matchMode, priority, splits: splitsPayload });
  };

  return (
    <form onSubmit={submit} className="surface p-4 md:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
      <div className="lg:col-span-2">
        <label htmlFor={ids.keyword} className="label mb-1.5 block">{t('ruleCreateForm.keywordLabel')}</label>
        <input
          id={ids.keyword}
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
        <label htmlFor={ids.category} className="label mb-1.5 block">{t('ruleCreateForm.categoryLabel')}</label>
        <select
          id={ids.category}
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
        <label htmlFor={ids.sign} className="label mb-1.5 block">{t('ruleCreateForm.signLabel')}</label>
        <select id={ids.sign} className="input" value={signConstraint} onChange={(e) => setSignConstraint(e.target.value as SignConstraint)}>
          <option value="any">{t('signOptions.any')}</option>
          <option value="negative">{t('signOptions.negative')}</option>
          <option value="positive">{t('signOptions.positive')}</option>
        </select>
      </div>
      <div>
        <label htmlFor={ids.mode} className="label mb-1.5 block">{t('ruleCreateForm.modeLabel')}</label>
        <select id={ids.mode} className="input" value={matchMode} onChange={(e) => setMatchMode(e.target.value as MatchMode)}>
          <option value="word">{t('matchModeOptions.word')}</option>
          <option value="substring">{t('matchModeOptions.substring')}</option>
          <option value="regex">{t('matchModeOptions.regex')}</option>
        </select>
      </div>
      <div>
        <label htmlFor={ids.priority} className="label mb-1.5 block">{t('ruleCreateForm.priorityLabel')}</label>
        <input
          id={ids.priority}
          inputMode="numeric"
          className="input font-mono"
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
        />
      </div>
      <div className="sm:col-span-2 lg:col-span-6">
        <label className="flex items-center gap-2 text-sm text-ink-200">
          <input
            type="checkbox"
            checked={splitMode}
            onChange={(e) => setSplitMode(e.target.checked)}
            className="h-4 w-4 accent-sage-300"
          />
          {t('split.toggleLabel')}
          <a
            href="https://gekkotron.github.io/Athena-Accounting/docs/users/categorization"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-sage-300 hover:text-sage-200 underline underline-offset-2"
          >{t('split.toggleHelpLinkLabel')}</a>
        </label>
        {splitMode && (
          <div className="mt-3">
            <RuleSplitEditor categories={categories} onChange={setSplitState} />
          </div>
        )}
      </div>
      <div className="sm:col-span-2 lg:col-span-6 flex items-center gap-3">
        <button className="btn-primary" disabled={submitting || (splitMode && !splitState.valid)}>
          {submitting ? t('ruleCreateForm.submitPending') : t('ruleCreateForm.submit')}
        </button>
        <button
          type="button"
          className="text-sm text-ink-300 hover:text-ink-100 border border-ink-700/60 hover:border-ink-600 rounded-md px-3 py-1.5 transition disabled:opacity-40"
          disabled={!keyword.trim() || previewing}
          onClick={() => void runPreview()}
        >
          {previewing ? t('ruleCreateForm.previewPending') : t('ruleCreateForm.preview')}
        </button>
        {successCount != null && successCount > 0 && (
          <span className="text-xs text-sage-300">
            {t('ruleCreateForm.successCount', { count: successCount })}
          </span>
        )}
      </div>
      {previewError && (
        <div className="sm:col-span-2 lg:col-span-6 text-sm text-clay-300">{previewError}</div>
      )}
      {preview && (
        <div className="sm:col-span-2 lg:col-span-6 space-y-3">
          {preview.map((p) => (
            <div key={p.keyword}>
              <div className="text-xs text-ink-400 mb-1">
                <span className="font-mono text-ink-300">« {p.keyword} »</span>{' '}
                <span>
                  {p.totalCount === 0
                    ? t('ruleCreateForm.previewEmpty')
                    : t('ruleCreateForm.previewCount', { count: p.totalCount })}
                </span>
              </div>
              {p.matches.length > 0 && (
                <ul className="text-xs divide-y divide-ink-800/40 border border-ink-800/40 rounded-md">
                  {p.matches.slice(0, PREVIEW_ROWS_SHOWN).map((m) => (
                    <li key={m.id} className="flex items-center gap-3 px-2.5 py-1.5">
                      <span className="font-mono text-ink-500 whitespace-nowrap">{m.date}</span>
                      <span className="truncate text-ink-200 flex-1">{m.rawLabel}</span>
                      <span className={`font-mono whitespace-nowrap ${amountSignClass(m.amount)}`}>
                        {formatAmount(m.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {p.totalCount > Math.min(p.matches.length, PREVIEW_ROWS_SHOWN) && (
                <div className="text-[11px] text-ink-500 mt-1">
                  {t('ruleCreateForm.previewMore', {
                    count: p.totalCount - Math.min(p.matches.length, PREVIEW_ROWS_SHOWN),
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </form>
  );
}
