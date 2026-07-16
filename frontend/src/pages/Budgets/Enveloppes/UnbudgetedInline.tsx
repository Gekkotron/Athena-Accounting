import { useState } from 'react';
import type { EnvelopeReportRow } from '../../../api/types';
import { formatAmount } from '../../../lib/format';

export function UnbudgetedInline(props: {
  rows: EnvelopeReportRow[];
  onCreate: (categoryId: number, suggestedAmount: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="surface p-4 flex flex-col gap-3">
      <button
        type="button"
        className="flex items-center justify-between text-sm text-ink-300"
        onClick={() => setOpen(!open)}
      >
        <span>Non budgétées ce mois ({props.rows.length})</span>
        <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ul className="flex flex-col gap-2 text-sm">
          {props.rows.map((r) => (
            <li key={r.categoryId} className="flex items-center justify-between">
              <span>
                {r.categoryName}{' '}
                <span className="text-ink-500 text-xs">
                  (dépensé {formatAmount(r.spend)})
                </span>
              </span>
              <button
                type="button"
                className="btn-ghost !py-1 !px-2 text-xs"
                onClick={() => props.onCreate(r.categoryId, r.spend)}
              >
                Créer une enveloppe
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
