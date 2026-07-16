import type { UseMutationResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Category, MatchMode, Rule, SignConstraint } from '../../api/types';
import { CategoryRow } from './CategoryRow';
import type { GroupedEntry } from './types';

export function GroupedView({
  grouped,
  byId,
  createBatch,
  updateRule,
  onRequestDelete,
  onEdit,
}: {
  grouped: GroupedEntry[];
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
  const { t } = useTranslation('rules');
  if (grouped.length === 0) {
    return (
      <div className="surface p-8 text-center text-ink-500 display-italic">
        {t('groupedView.emptyState')}
      </div>
    );
  }

  return (
    <div className="surface overflow-hidden">
      <div className="divide-y divide-ink-800/60">
        {grouped.map((g) => (
          <CategoryRow
            key={g.category.id}
            group={g}
            byId={byId}
            createBatch={createBatch}
            updateRule={updateRule}
            onRequestDelete={onRequestDelete}
            onEdit={onEdit}
          />
        ))}
      </div>
    </div>
  );
}
