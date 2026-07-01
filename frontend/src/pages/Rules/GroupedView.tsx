import type { UseMutationResult } from '@tanstack/react-query';
import type { MatchMode, Rule, SignConstraint } from '../../api/types';
import { CategoryRow } from './CategoryRow';
import type { GroupedEntry } from './types';

export function GroupedView({
  grouped,
  createBatch,
  updateRule,
  onRequestDelete,
  onEdit,
}: {
  grouped: GroupedEntry[];
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
  if (grouped.length === 0) {
    return (
      <div className="surface p-8 text-center text-ink-500 display-italic">
        Aucune catégorie. Créez-en une dans l'onglet « Catégories ».
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
