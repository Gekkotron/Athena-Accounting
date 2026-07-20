import { useTranslation } from 'react-i18next';
import type { Category } from '../../api/types';
import { kindBadgeClass, kindLabel } from '../../lib/categories';

export function DragGhost({
  id,
  byId,
}: {
  id: number;
  byId: Map<number, Category>;
}): JSX.Element | null {
  const { t } = useTranslation('common');
  const c = byId.get(id);
  if (!c) return null;
  return (
    <div className="surface px-3 py-2 text-sm flex items-center gap-2 shadow-lg">
      {c.color && (
        <span
          className="h-2 w-2 rounded-full border border-ink-700 shrink-0"
          style={{ backgroundColor: c.color }}
        />
      )}
      <span>{c.name}</span>
      <span className={kindBadgeClass(c.kind)}>{kindLabel(c.kind, t)}</span>
    </div>
  );
}
