import { useEffect, useMemo, useRef, useState } from 'react';
import type { Category, TransactionSplit } from '../../api/types';

export type DraftSplit = {
  key: string;
  categoryId: number | '';
  amountMagnitude: string;   // unsigned, decimal with dot or comma
  memo: string;
};

function toCents(mag: string): number {
  const cleaned = mag.replace(/€/g, '').replace(/\s+/g, '').replace(',', '.').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return NaN;
  return Math.round(Number(cleaned) * 100);
}

function centsToMag(cents: number): string {
  return (cents / 100).toFixed(2);
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function fromInitial(initial: TransactionSplit[]): DraftSplit[] {
  return initial.map((s) => ({
    key: `s-${s.id}`,
    categoryId: s.categoryId ?? '',
    amountMagnitude: Math.abs(Number(s.amount)).toFixed(2),
    memo: s.memo ?? '',
  }));
}

export function SplitEditor({
  parentAmountMagnitude,
  parentAmountSign,
  disabled = false,
  initial,
  resetKey,
  categories,
  onChange,
}: {
  parentAmountMagnitude: number;
  parentAmountSign: -1 | 1 | 0;
  disabled?: boolean;
  initial: TransactionSplit[];
  resetKey: string | number;
  categories: Category[];
  onChange: (splits: DraftSplit[]) => void;
}) {
  const [rows, setRows] = useState<DraftSplit[]>(() => fromInitial(initial));

  // Rehydrate only when resetKey changes, not on every render.
  const lastResetKeyRef = useRef(resetKey);
  useEffect(() => {
    if (lastResetKeyRef.current !== resetKey) {
      lastResetKeyRef.current = resetKey;
      setRows(fromInitial(initial));
    }
  }, [resetKey, initial]);

  const parentCents = Math.round(parentAmountMagnitude * 100);
  const remainderCents = useMemo(() => {
    const sum = rows.reduce((acc, r) => {
      const c = toCents(r.amountMagnitude);
      return acc + (Number.isFinite(c) ? c : 0);
    }, 0);
    return parentCents - sum;
  }, [rows, parentCents]);

  function update(next: DraftSplit[]) {
    setRows(next);
    onChange(next);
  }

  function seedTwo() {
    const half = Math.floor(parentCents / 2);
    const rest = parentCents - half;
    update([
      { key: uid(), categoryId: '', amountMagnitude: centsToMag(half), memo: '' },
      { key: uid(), categoryId: '', amountMagnitude: centsToMag(rest), memo: '' },
    ]);
  }

  function rebalanceLast(next: DraftSplit[]) {
    if (next.length === 0) return next;
    const withoutLast = next.slice(0, -1);
    const sumWithoutLast = withoutLast.reduce((acc, r) => {
      const c = toCents(r.amountMagnitude);
      return acc + (Number.isFinite(c) ? c : 0);
    }, 0);
    const lastCents = parentCents - sumWithoutLast;
    return [
      ...withoutLast,
      { ...next[next.length - 1], amountMagnitude: centsToMag(Math.max(0, lastCents)) },
    ];
  }

  function editRow(idx: number, patch: Partial<DraftSplit>) {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    // If magnitude changed and there are 2+ rows, rebalance the last row.
    if (patch.amountMagnitude !== undefined && next.length >= 2 && idx !== next.length - 1) {
      update(rebalanceLast(next));
    } else {
      update(next);
    }
  }

  function addRow() {
    const next: DraftSplit[] = [
      ...rows,
      { key: uid(), categoryId: '', amountMagnitude: '0.00', memo: '' },
    ];
    update(rebalanceLast(next));
  }

  function removeRow(idx: number) {
    const dropped = rows[idx];
    const droppedCents = toCents(dropped.amountMagnitude);
    const remaining = rows.filter((_, i) => i !== idx);
    if (remaining.length === 0) {
      update([]);
      return;
    }
    // Move the dropped magnitude into the last remaining row so sum stays constant.
    const lastIdx = remaining.length - 1;
    const lastCents = toCents(remaining[lastIdx].amountMagnitude);
    remaining[lastIdx] = {
      ...remaining[lastIdx],
      amountMagnitude: centsToMag((Number.isFinite(lastCents) ? lastCents : 0) + (Number.isFinite(droppedCents) ? droppedCents : 0)),
    };
    update(remaining);
  }

  if (disabled) {
    return (
      <div className="mt-4 text-xs text-ink-500">
        La ventilation n'est pas disponible pour un virement interne.
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="mt-4">
        <button type="button" className="btn-ghost text-sm" onClick={seedTwo} disabled={parentCents === 0}>
          + Ventiler cette transaction
        </button>
      </div>
    );
  }

  const remainderTone =
    remainderCents === 0
      ? 'border-sage-800/40 bg-sage-900/15 text-sage-200'
      : 'border-clay-800/60 bg-clay-900/30 text-clay-200';
  const signPrefix = parentAmountSign < 0 ? '-' : '';

  return (
    <div className="mt-4">
      <div className="label mb-2">Ventilation par catégorie</div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.key} className="flex items-center gap-2">
            <input
              className="input font-mono w-28"
              inputMode="decimal"
              value={r.amountMagnitude}
              onChange={(e) => editRow(i, { amountMagnitude: e.target.value })}
              onKeyDown={(e) => { if (e.key === '-') e.preventDefault(); }}
              placeholder="0,00"
            />
            <select
              className="input flex-1"
              value={r.categoryId}
              onChange={(e) => editRow(i, { categoryId: e.target.value ? Number(e.target.value) : '' })}
            >
              <option value="">— catégorie</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input
              className="input flex-1"
              placeholder="mémo (optionnel)"
              value={r.memo}
              onChange={(e) => editRow(i, { memo: e.target.value })}
            />
            <button
              type="button"
              className="btn-ghost !py-1 !px-2 text-ink-500 hover:text-clay-300"
              aria-label="Retirer cette ligne"
              title="Retirer cette ligne"
              onClick={() => removeRow(i)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div
        data-testid="split-remainder"
        className={`mt-2 rounded-lg border px-3 py-2 text-xs flex items-center justify-between gap-3 ${remainderTone}`}
      >
        <span>
          Reste à ventiler :{' '}
          <span className="font-mono">
            {remainderCents !== 0 ? signPrefix : ''}
            {centsToMag(Math.abs(remainderCents))} €
          </span>
        </span>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost !py-1 !px-2 text-sm" onClick={addRow}>
            + Ajouter une ligne
          </button>
          <button type="button" className="btn-ghost !py-1 !px-2 text-sm" onClick={() => update([])}>
            Supprimer la ventilation
          </button>
        </div>
      </div>
    </div>
  );
}
