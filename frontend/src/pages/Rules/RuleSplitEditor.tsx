import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Category } from '../../api/types';
import { formatCategoryPath } from '../../lib/categories';

export interface SplitDraft {
  categoryId: number | null;
  percent: number;
}

const MIN_ROWS = 2;
const MAX_ROWS = 20;

interface Props {
  categories: Category[];
  initial?: SplitDraft[];
  onChange: (state: { splits: SplitDraft[]; valid: boolean }) => void;
}

function isValid(rows: SplitDraft[]): boolean {
  if (rows.length < MIN_ROWS || rows.length > MAX_ROWS) return false;
  if (!rows.every((r) => Number.isInteger(r.percent) && r.percent >= 1 && r.percent <= 99)) return false;
  if (!rows.every((r) => r.categoryId != null)) return false;
  const sum = rows.reduce((a, r) => a + r.percent, 0);
  return sum === 100;
}

// Standalone ventilation editor for the split-mode rule form. Emits
// {splits, valid} upward on every change so the parent form can gate its
// submit button + payload assembly on a well-formed 100 %-sum set.
// Kept independent of RuleCreateForm / AdvancedEditor so both share one
// implementation and neither file busts the 300-line max-lines gate.
export function RuleSplitEditor({ categories, initial, onChange }: Props) {
  const { t } = useTranslation('rules');
  const [rows, setRows] = useState<SplitDraft[]>(() =>
    initial && initial.length >= MIN_ROWS
      ? initial.map((r) => ({ ...r }))
      : [
          { categoryId: null, percent: 0 },
          { categoryId: null, percent: 0 },
        ],
  );
  const byId = useMemo(
    () => new Map(categories.map((c) => [c.id, c] as const)),
    [categories],
  );

  // Fire once on mount + on every row edit — avoids the caller needing a
  // separate "get current value" method.
  const changeRef = useRef(onChange);
  useEffect(() => { changeRef.current = onChange; }, [onChange]);
  useEffect(() => {
    changeRef.current({ splits: rows, valid: isValid(rows) });
  }, [rows]);

  const sum = rows.reduce((a, r) => a + r.percent, 0);
  const sortedCats = useMemo(
    () => [...categories].sort((a, b) => {
      const pa = a.parentId != null ? byId.get(a.parentId)?.name ?? '' : a.name;
      const pb = b.parentId != null ? byId.get(b.parentId)?.name ?? '' : b.name;
      return pa.localeCompare(pb) || a.name.localeCompare(b.name);
    }),
    [categories, byId],
  );

  function editRow(idx: number, patch: Partial<SplitDraft>) {
    setRows((cur) => cur.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addRow() {
    if (rows.length >= MAX_ROWS) return;
    setRows((cur) => [...cur, { categoryId: null, percent: 0 }]);
  }

  function removeRow(idx: number) {
    if (rows.length <= MIN_ROWS) return;
    setRows((cur) => cur.filter((_, i) => i !== idx));
  }

  const canRemove = rows.length > MIN_ROWS;
  const canAdd = rows.length < MAX_ROWS;
  const sumOk = sum === 100;

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, idx) => (
        <div key={idx} className="flex items-end gap-2">
          <div className="flex-1">
            {idx === 0 && (
              <label className="label mb-1.5 block">{t('split.categoryLabel')}</label>
            )}
            <select
              className="input-sm w-full"
              aria-label={t('split.categoryLabel')}
              value={row.categoryId ?? ''}
              onChange={(e) => editRow(idx, { categoryId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">—</option>
              {sortedCats.map((c) => (
                <option key={c.id} value={c.id}>{formatCategoryPath(c, byId)}</option>
              ))}
            </select>
          </div>
          <div className="w-20">
            {idx === 0 && (
              <label className="label mb-1.5 block">{t('split.percentLabel')}</label>
            )}
            <input
              type="number"
              min={1}
              max={99}
              step={1}
              aria-label={t('split.percentLabel')}
              className="input-sm font-mono text-right w-full"
              value={row.percent || ''}
              onChange={(e) => {
                const n = Number(e.target.value);
                editRow(idx, { percent: Number.isFinite(n) ? n : 0 });
              }}
            />
          </div>
          <div className="w-16 flex justify-end">
            {canRemove && (
              <button
                type="button"
                className="text-xs text-ink-500 hover:text-clay-300 transition"
                onClick={() => removeRow(idx)}
              >
                {t('split.removeRow')}
              </button>
            )}
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between mt-1">
        <button
          type="button"
          className="text-sm text-sage-300 hover:text-sage-200 disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={addRow}
          disabled={!canAdd}
        >
          {t('split.addRow')}
        </button>
        <div className={`text-sm font-mono ${sumOk ? 'text-sage-300' : 'text-amber-300'}`}>
          {t('split.sumLabel')} : {sum} %
        </div>
      </div>
      {!sumOk && (
        <div className="text-xs text-amber-300/90 mt-1">
          {t('split.sumMustBe100')}
        </div>
      )}
    </div>
  );
}
