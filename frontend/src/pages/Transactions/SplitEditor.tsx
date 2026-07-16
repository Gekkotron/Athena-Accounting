import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Category, TransactionSplit } from '../../api/types';
import { formatCategoryPath } from '../../lib/categories';

export type DraftSplit = {
  key: string;
  categoryId: number | '';
  amountMagnitude: string;   // unsigned, decimal with dot or comma
  memo: string;
};

// Parses a magnitude string (unsigned, up to 2 decimal digits, dot or comma).
// Returns null on any malformed input. Used identically by SplitEditor and
// TransactionModal so client validation matches server acceptance.
export function parseMagnitudeCents(raw: string): number | null {
  const cleaned = String(raw).replace(/€/g, '').replace(/\s+/g, '').replace(',', '.').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isFinite(cents) ? cents : null;
}

function toCents(mag: string): number {
  const cents = parseMagnitudeCents(mag);
  return cents === null ? NaN : cents;
}

function centsToMag(cents: number): string {
  return (cents / 100).toFixed(2);
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function fromInitial(initial: TransactionSplit[]): DraftSplit[] {
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
  const { t } = useTranslation('transactions');
  const [rows, setRows] = useState<DraftSplit[]>(() => fromInitial(initial));
  const byId = useMemo(
    () => new Map(categories.map((c) => [c.id, c] as const)),
    [categories],
  );

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
    // When the sibling rows overshoot parent, leave the last row's magnitude
    // untouched — the remainder chip already flags the overflow, and clamping
    // to zero would misdirect the user's attention to the wrong row.
    if (lastCents < 0) return next;
    return [
      ...withoutLast,
      { ...next[next.length - 1], amountMagnitude: centsToMag(lastCents) },
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
        {t('splitEditor.disabledHint')}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="mt-4">
        <button type="button" className="btn-ghost text-sm" onClick={seedTwo} disabled={parentCents === 0}>
          {t('splitEditor.actions.start')}
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
      <div className="label mb-2">{t('splitEditor.title')}</div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.key} className="flex items-center gap-2">
            <input
              className="input font-mono w-28"
              inputMode="decimal"
              value={r.amountMagnitude}
              onChange={(e) => editRow(i, { amountMagnitude: e.target.value })}
              onKeyDown={(e) => { if (e.key === '-') e.preventDefault(); }}
              placeholder={t('splitEditor.placeholders.amount')}
            />
            <select
              className="input flex-1"
              value={r.categoryId}
              onChange={(e) => editRow(i, { categoryId: e.target.value ? Number(e.target.value) : '' })}
            >
              <option value="">{t('splitEditor.options.category')}</option>
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
            <input
              className="input flex-1"
              placeholder={t('splitEditor.placeholders.memo')}
              value={r.memo}
              onChange={(e) => editRow(i, { memo: e.target.value })}
            />
            <button
              type="button"
              className="btn-ghost !py-1 !px-2 text-ink-500 hover:text-clay-300"
              aria-label={t('splitEditor.actions.removeLine')}
              title={t('splitEditor.actions.removeLine')}
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
          {t('splitEditor.remainderLabel')}{' '}
          <span className="font-mono">
            {remainderCents !== 0 ? signPrefix : ''}
            {centsToMag(Math.abs(remainderCents))} €
          </span>
        </span>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost !py-1 !px-2 text-sm" onClick={addRow}>
            {t('splitEditor.actions.addLine')}
          </button>
          <button type="button" className="btn-ghost !py-1 !px-2 text-sm" onClick={() => update([])}>
            {t('splitEditor.actions.removeSplit')}
          </button>
        </div>
      </div>
    </div>
  );
}
