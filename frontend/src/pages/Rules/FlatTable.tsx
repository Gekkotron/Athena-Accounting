import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseMutationResult } from '@tanstack/react-query';
import type { Category, MatchMode, Rule, SignConstraint } from '../../api/types';
import { formatCategoryPath } from '../../lib/categories';

export function FlatTable({
  rules,
  cats,
  updateRule,
  onRequestDelete,
}: {
  rules: Rule[];
  cats: Category[];
  updateRule: UseMutationResult<unknown, Error, { id: number; patch: Partial<Rule> }>;
  onRequestDelete: (rule: Rule) => void;
}) {
  const { t } = useTranslation('rules');
  const byId = useMemo(
    () => new Map(cats.map((c) => [c.id, c] as const)),
    [cats],
  );
  return (
    <div className="surface overflow-hidden">
      <div className="table-scroll">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr className="border-b border-ink-800/70">
              <th className="px-4 py-3 label font-normal">{t('flatTable.columns.keyword')}</th>
              <th className="px-4 py-3 label font-normal">{t('flatTable.columns.category')}</th>
              <th className="px-4 py-3 label font-normal hidden md:table-cell">{t('flatTable.columns.sign')}</th>
              <th className="px-4 py-3 label font-normal hidden md:table-cell">{t('flatTable.columns.mode')}</th>
              <th className="px-4 py-3 label font-normal text-right">{t('flatTable.columns.priority')}</th>
              <th className="px-4 py-3 label font-normal">{t('flatTable.columns.active')}</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-500 display-italic">
                  {t('flatTable.empty')}
                </td>
              </tr>
            ) : (
              rules.map((r) => (
                <tr key={r.id} className="border-b border-ink-800/40 last:border-0 hover:bg-ink-850/40 transition">
                  <td className="px-4 py-2.5">
                    <input
                      defaultValue={r.keyword}
                      key={`kw-${r.id}-${r.keyword}`}
                      className="input-sm font-mono"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== r.keyword) {
                          updateRule.mutate({ id: r.id, patch: { keyword: v } });
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') (e.target as HTMLInputElement).value = r.keyword;
                      }}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      className="input-sm"
                      value={r.categoryId}
                      onChange={(e) =>
                        updateRule.mutate({ id: r.id, patch: { categoryId: Number(e.target.value) } })
                      }
                    >
                      {[...cats]
                        .sort((a, b) => {
                          const pa = a.parentId != null ? byId.get(a.parentId)?.name ?? '' : a.name;
                          const pb = b.parentId != null ? byId.get(b.parentId)?.name ?? '' : b.name;
                          return pa.localeCompare(pb) || a.name.localeCompare(b.name);
                        })
                        .map((c) => (
                          <option key={c.id} value={c.id}>{formatCategoryPath(c, byId)}</option>
                        ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <select
                      className="input-sm"
                      value={r.signConstraint}
                      onChange={(e) =>
                        updateRule.mutate({
                          id: r.id,
                          patch: { signConstraint: e.target.value as SignConstraint },
                        })
                      }
                    >
                      <option value="any">{t('signOptions.any')}</option>
                      <option value="negative">{t('signOptions.negative')}</option>
                      <option value="positive">{t('signOptions.positive')}</option>
                    </select>
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <select
                      className="input-sm"
                      value={r.matchMode}
                      onChange={(e) =>
                        updateRule.mutate({
                          id: r.id,
                          patch: { matchMode: e.target.value as MatchMode },
                        })
                      }
                    >
                      <option value="word">{t('matchModeOptions.word')}</option>
                      <option value="substring">{t('matchModeOptions.substring')}</option>
                      <option value="regex">{t('matchModeOptions.regex')}</option>
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <input
                      inputMode="numeric"
                      defaultValue={r.priority}
                      key={`pri-${r.id}-${r.priority}`}
                      className="input-sm font-mono text-right w-16 ml-auto"
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isInteger(v) && v >= 0 && v !== r.priority) {
                          updateRule.mutate({ id: r.id, patch: { priority: v } });
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) =>
                        updateRule.mutate({ id: r.id, patch: { enabled: e.target.checked } })
                      }
                      className="h-4 w-4 rounded border-ink-700 bg-ink-900 accent-sage-300"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      className="text-[11px] text-ink-500 hover:text-clay-300 transition"
                      onClick={() => onRequestDelete(r)}
                    >
                      {t('flatTable.deleteRow')}
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
