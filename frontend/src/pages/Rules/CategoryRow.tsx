import { useState } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import type { Category, MatchMode, Rule, SignConstraint } from '../../api/types';
import { Chip } from './Chip';

interface GroupedEntry {
  category: Category;
  rules: Rule[];
}

export function CategoryRow({
  group,
  createBatch,
  updateRule,
  onRequestDelete,
  onEdit,
}: {
  group: GroupedEntry;
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
          <span className="font-medium text-ink-100 truncate">{category.name}</span>
        </div>
        <div className="text-[11px] text-ink-500 mt-0.5">
          {KIND_FR[category.kind]} ·{' '}
          <span className="font-mono">
            {rules.length} mot{rules.length > 1 ? 's' : ''}-clé{rules.length > 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Chips */}
      <div className="flex-1 flex flex-wrap items-center gap-1.5 min-w-0">
        {rules.length === 0 ? (
          <span className="text-[11px] text-ink-600 display-italic">aucun mot-clé</span>
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
            désactiver tout
          </button>
        )}
        {hasDisabled && (
          <button
            className="text-ink-500 hover:text-ink-100 transition whitespace-nowrap"
            onClick={() => setEnabledAll(true)}
          >
            tout activer
          </button>
        )}
      </div>
    </div>
  );
}

const KIND_FR: Record<Category['kind'], string> = {
  expense: 'Dépense',
  income: 'Revenu',
  transfer: 'Virement',
  neutral: 'Neutre',
};

function AddChipInput({ onAdd }: { onAdd: (keywords: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-ink-700 text-ink-500 hover:text-ink-100 hover:border-ink-600 px-2.5 py-0.5 text-xs transition"
      >
        + ajouter
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
        placeholder="dentiste, pharma…"
        className="rounded-full border border-ink-700 bg-ink-900 px-2.5 py-0.5 text-xs font-mono text-ink-100 placeholder:text-ink-600 focus:border-sage-300/50 w-44"
      />
    </form>
  );
}
