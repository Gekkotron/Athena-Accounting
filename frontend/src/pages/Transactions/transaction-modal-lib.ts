import type { Transaction } from '../../api/types';
import { parseMagnitudeCents, type DraftSplit } from './SplitEditor';

export type TxPatch = Partial<{
  accountId: number;
  date: string;
  amount: string;
  rawLabel: string;
  categoryId: number | null;
  notes: string | null;
  lockYears: number | null;
}>;

// The wire-contract patch built from the current form state and the
// original transaction being edited. ONLY fields that actually changed
// appear in the returned object — the parent PATCH endpoint rejects an
// empty body, so callers combine this with a "did the splits change too?"
// check before deciding whether to skip the network call entirely.
export function buildPatchDiff(
  original: Transaction,
  next: {
    accountId: number;
    isoDate: string;
    amount: string;
    rawLabel: string;
    categoryId: number | '';
    notes: string;
    lockYears: number | null;
  },
): TxPatch {
  const patch: TxPatch = {};
  if (next.accountId !== original.accountId) patch.accountId = next.accountId;
  if (next.isoDate !== original.date.slice(0, 10)) patch.date = next.isoDate;
  if (next.amount !== original.amount) patch.amount = next.amount;
  if (next.rawLabel.trim() !== original.rawLabel) patch.rawLabel = next.rawLabel.trim();
  if ((next.categoryId || null) !== original.categoryId) {
    patch.categoryId = next.categoryId || null;
  }
  const cleanedNotes = next.notes.trim() || null;
  if (cleanedNotes !== original.notes) patch.notes = cleanedNotes;
  if (next.lockYears !== (original.lockYears ?? null)) {
    patch.lockYears = next.lockYears;
  }
  return patch;
}

export type ParsedLockYears =
  | { ok: true; value: number | null }
  | { ok: false };

// Blank input → null (no per-tx override, transaction inherits account-level
// rule). Non-blank must be an integer in [0, 99]; otherwise the caller should
// surface a validation error rather than silently normalising.
export function parseLockYearsInput(raw: string): ParsedLockYears {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: null };
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0 || n > 99) return { ok: false };
  return { ok: true, value: n };
}

// True when the current split-editor draft is byte-equivalent to the
// initial splits stored on the transaction (same categoryId, same signed
// cents amount, same trimmed memo). Used to skip the network call when
// the user opens and closes the modal without changing anything.
export function draftMatchesInitial(
  draft: DraftSplit[],
  initial: Transaction['splits'],
  parentCents: number,
): boolean {
  if (initial.length !== draft.length) return false;
  const sign = parentCents < 0 ? -1 : 1;
  return draft.every((r, i) => {
    const init = initial[i];
    if (r.categoryId === '') return false;
    if (init.categoryId !== r.categoryId) return false;
    const draftSignedCents = (parseMagnitudeCents(r.amountMagnitude) ?? 0) * sign;
    const initCents = Math.round(Number(init.amount) * 100);
    if (draftSignedCents !== initCents) return false;
    const draftMemo = r.memo.trim() || null;
    const initMemo = init.memo && init.memo.trim() ? init.memo : null;
    return draftMemo === initMemo;
  });
}
