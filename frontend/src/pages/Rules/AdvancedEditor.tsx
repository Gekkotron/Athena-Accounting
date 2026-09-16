import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Category, MatchMode, Rule, SignConstraint } from '../../api/types';
import { formatCategoryPath } from '../../lib/categories';
import { RuleSplitEditor, type SplitDraft } from './RuleSplitEditor';

// PATCH shape carries splits as a three-state (null/[] revert, non-empty
// replace); mirrors the backend's PUT /api/rules/:id semantics. The base
// Partial<Rule> types splits as an array-only optional, so we omit + widen.
type RulePatchWithSplits = Omit<Partial<Rule>, 'splits'> & {
  splits?: Array<{ categoryId: number; percent: number }> | null;
};

export function AdvancedEditor({
  rule,
  categories,
  onClose,
  onSave,
  onDelete,
}: {
  rule: Rule;
  categories: Category[];
  onClose: () => void;
  onSave: (patch: Partial<Rule>) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation(['rules', 'common']);
  const byId = useMemo(
    () => new Map(categories.map((c) => [c.id, c] as const)),
    [categories],
  );
  const [keyword, setKeyword] = useState(rule.keyword);
  const [categoryId, setCategoryId] = useState(rule.categoryId);
  const [signConstraint, setSignConstraint] = useState<SignConstraint>(rule.signConstraint);
  const [matchMode, setMatchMode] = useState<MatchMode>(rule.matchMode);
  const [priority, setPriority] = useState(rule.priority);
  const [enabled, setEnabled] = useState(rule.enabled);
  const initialHasSplits = (rule.splits ?? []).length >= 2;
  const [splitMode, setSplitMode] = useState(initialHasSplits);
  const [splitState, setSplitState] = useState<{ splits: SplitDraft[]; valid: boolean }>(() => ({
    splits: (rule.splits ?? []).map((s) => ({ categoryId: s.categoryId, percent: s.percent })),
    valid: initialHasSplits,
  }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (splitMode && !splitState.valid) return;
    const patch: RulePatchWithSplits = {};
    if (keyword.trim() && keyword.trim() !== rule.keyword) patch.keyword = keyword.trim();
    if (categoryId !== rule.categoryId) patch.categoryId = categoryId;
    if (signConstraint !== rule.signConstraint) patch.signConstraint = signConstraint;
    if (matchMode !== rule.matchMode) patch.matchMode = matchMode;
    if (priority !== rule.priority) patch.priority = priority;
    if (enabled !== rule.enabled) patch.enabled = enabled;
    if (splitMode) {
      patch.splits = splitState.splits.map((s) => ({
        categoryId: s.categoryId as number,
        percent: s.percent,
      }));
    } else if (initialHasSplits) {
      patch.splits = null;
    }
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    onSave(patch as Partial<Rule>);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-ink-950/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="surface w-full max-w-md p-6"
      >
        <div className="mb-4">
          <div className="label mb-1">{t('advancedEditor.ruleLabel')}</div>
          <div className="font-mono text-sm text-ink-100 truncate">{rule.keyword}</div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="label mb-1.5 block">{t('advancedEditor.keywordLabel')}</label>
            <input
              className="input font-mono"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label mb-1.5 block">{t('advancedEditor.categoryLabel')}</label>
            <select
              className="input"
              value={categoryId}
              onChange={(e) => setCategoryId(Number(e.target.value))}
            >
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
            <label className="label mb-1.5 block">{t('advancedEditor.signLabel')}</label>
            <select
              className="input"
              value={signConstraint}
              onChange={(e) => setSignConstraint(e.target.value as SignConstraint)}
            >
              <option value="any">{t('signOptions.any')}</option>
              <option value="negative">{t('signOptions.negative')}</option>
              <option value="positive">{t('signOptions.positive')}</option>
            </select>
          </div>
          <div>
            <label className="label mb-1.5 block">{t('advancedEditor.modeLabel')}</label>
            <select
              className="input"
              value={matchMode}
              onChange={(e) => setMatchMode(e.target.value as MatchMode)}
            >
              <option value="word">{t('matchModeOptions.word')}</option>
              <option value="substring">{t('matchModeOptions.substring')}</option>
              <option value="regex">{t('matchModeOptions.regex')}</option>
            </select>
          </div>
          <div>
            <label className="label mb-1.5 block">{t('advancedEditor.priorityLabel')}</label>
            <input
              inputMode="numeric"
              className="input font-mono"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-ink-200 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-ink-700 bg-ink-900 accent-sage-300"
              />
              {t('advancedEditor.enabledLabel')}
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className="flex items-center gap-2 text-sm text-ink-200">
              <input
                type="checkbox"
                checked={splitMode}
                onChange={(e) => setSplitMode(e.target.checked)}
                className="h-4 w-4 accent-sage-300"
              />
              {t('split.toggleLabel')}
            </label>
            {splitMode && (
              <div className="mt-3">
                <RuleSplitEditor
                  categories={categories}
                  initial={(rule.splits ?? []).map((s) => ({ categoryId: s.categoryId, percent: s.percent }))}
                  onChange={setSplitState}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 mt-6 pt-4 border-t border-ink-800/60">
          <button
            type="button"
            onClick={onDelete}
            className="text-xs text-clay-300 hover:text-clay-200 transition"
          >
            {t('delete', { ns: 'common' })}
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              {t('cancel', { ns: 'common' })}
            </button>
            <button type="submit" className="btn-primary">
              {t('save', { ns: 'common' })}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
