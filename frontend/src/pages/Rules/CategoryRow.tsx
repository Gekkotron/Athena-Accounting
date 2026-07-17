import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseMutationResult } from '@tanstack/react-query';
import type { Category, MatchMode, Rule, SignConstraint } from '../../api/types';
import { kindLabel, kindBadgeClass, formatCategoryPath } from '../../lib/categories';
import { Chip } from './Chip';
import type { GroupedEntry } from './types';

export function CategoryRow({
  group,
  byId,
  createBatch,
  updateRule,
  onRequestDelete,
  onEdit,
}: {
  group: GroupedEntry;
  byId: Map<number, Category>;
  createBatch: UseMutationResult<
    number,
    Error,
    {
      keywords: string[];
      categoryId: number;
      signConstraint: SignConstraint;
      matchMode: MatchMode;
      priority: number;
    }
  >;
  updateRule: UseMutationResult<unknown, Error, { id: number; patch: Partial<Rule> }>;
  onRequestDelete: (rule: Rule) => void;
  onEdit: (rule: Rule) => void;
}) {
  const { t } = useTranslation(['rules', 'common']);
  const { category, rules } = group;
  const hasEnabled = rules.some((r) => r.enabled);
  const hasDisabled = rules.some((r) => !r.enabled);

  const defaultSign: SignConstraint =
    category.kind === 'expense' ? 'negative' : category.kind === 'income' ? 'positive' : 'any';

  const setEnabledAll = (enabled: boolean) => {
    for (const r of rules) {
      if (r.enabled !== enabled) updateRule.mutate({ id: r.id, patch: { enabled } });
    }
  };

  return (
    <div className="px-4 py-4 md:px-5 flex flex-col gap-3 md:flex-row md:items-start md:gap-5">
      {/* Category header */}
      <div className="md:w-48 shrink-0">
        <div className="flex items-center gap-2">
          {category.color && (
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: category.color }}
            />
          )}
          <span className="font-medium text-ink-100 truncate">{formatCategoryPath(category, byId)}</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className={kindBadgeClass(category.kind)}>{kindLabel(category.kind, t)}</span>
          <span className="text-[11px] text-ink-500 font-mono">
            {rules.length} {t('categoryRow.keywordCount', { count: rules.length })}
          </span>
        </div>
      </div>

      {/* Chips */}
      <div className="flex-1 flex flex-wrap items-center gap-1.5 min-w-0">
        {rules.length === 0 ? (
          <span className="text-[11px] text-ink-600 display-italic">{t('categoryRow.noKeywords')}</span>
        ) : (
          rules.map((r) => (
            <Chip
              key={r.id}
              rule={r}
              onToggle={() => updateRule.mutate({ id: r.id, patch: { enabled: !r.enabled } })}
              onAdvanced={() => onEdit(r)}
              onDelete={() => onRequestDelete(r)}
            />
          ))
        )}
        <AddChipInput
          onAdd={(keywords) => {
            createBatch.mutate({
              keywords,
              categoryId: category.id,
              signConstraint: defaultSign,
              matchMode: 'word',
              priority: 0,
            });
          }}
        />
      </div>

      {/* Bulk actions */}
      <div className="flex flex-wrap gap-3 md:gap-2 md:flex-col md:items-end shrink-0 text-[11px]">
        {hasEnabled && (
          <button
            className="text-ink-500 hover:text-ink-100 transition whitespace-nowrap"
            onClick={() => setEnabledAll(false)}
          >
            {t('categoryRow.disableAll')}
          </button>
        )}
        {hasDisabled && (
          <button
            className="text-ink-500 hover:text-ink-100 transition whitespace-nowrap"
            onClick={() => setEnabledAll(true)}
          >
            {t('categoryRow.enableAll')}
          </button>
        )}
      </div>
    </div>
  );
}

function AddChipInput({ onAdd }: { onAdd: (keywords: string[]) => void }) {
  const { t } = useTranslation('rules');
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-ink-700 text-ink-500 hover:text-ink-100 hover:border-ink-600 px-2.5 py-0.5 text-xs transition"
      >
        {t('categoryRow.addChip')}
      </button>
    );
  }

  const commit = () => {
    const keywords = Array.from(
      new Set(value.split(',').map((s) => s.trim()).filter(Boolean)),
    );
    if (keywords.length > 0) onAdd(keywords);
    setValue('');
    setOpen(false);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
      className="inline-flex items-center"
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value.trim()) commit();
          else setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setValue('');
            setOpen(false);
          }
        }}
        placeholder={t('categoryRow.addChipPlaceholder')}
        className="rounded-full border border-ink-700 bg-ink-900 px-2.5 py-0.5 text-xs font-mono text-ink-100 placeholder:text-ink-600 focus:border-sage-300/50 w-44"
      />
    </form>
  );
}
