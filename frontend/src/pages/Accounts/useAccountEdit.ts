import { useState } from 'react';
import type { Account } from '../../api/types';

export type EditDraft = {
  name: string;
  type: string;
  currency: string;
  openingBalance: string;
  openingDate: string;
  lockYears: number | null;
};

// Per-card edit state: only one account can be in edit mode at a time,
// the draft is local so cancelling discards the in-flight changes cleanly,
// and saveEdit diffs the draft against the original account to build a
// minimal patch (skips the update entirely when nothing changed).
type UpdateMutator = {
  mutate: (
    input: { id: number; patch: Partial<Account> },
    options?: { onSuccess?: () => void },
  ) => void;
};

export function useAccountEdit(
  updateAccount: UpdateMutator,
  resetEditError: () => void,
) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  const startEdit = (a: Account) => {
    resetEditError();
    setEditingId(a.id);
    setEditDraft({
      name: a.name,
      type: a.type,
      currency: a.currency,
      openingBalance: a.openingBalance,
      openingDate: a.openingDate,
      lockYears: a.lockYears ?? null,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
    resetEditError();
  };

  // `draft` is passed explicitly (not read from editDraft state) because
  // setEditDraft(values) hasn't re-rendered yet when saveEdit runs in the
  // same event handler tick. Characterization test #3 is the safety net.
  const saveEdit = (a: Account, draft: EditDraft | null) => {
    if (!draft) return;
    const patch: Partial<Account> = {};
    if (draft.name !== a.name) patch.name = draft.name.trim();
    if (draft.type !== a.type) patch.type = draft.type;
    if (draft.currency !== a.currency) patch.currency = draft.currency.toUpperCase();
    if (draft.openingBalance !== a.openingBalance) patch.openingBalance = draft.openingBalance;
    if (draft.openingDate !== a.openingDate) patch.openingDate = draft.openingDate;
    if ((draft.lockYears ?? null) !== (a.lockYears ?? null)) patch.lockYears = draft.lockYears;
    if (Object.keys(patch).length === 0) {
      cancelEdit();
      return;
    }
    resetEditError();
    updateAccount.mutate({ id: a.id, patch }, { onSuccess: cancelEdit });
  };

  return { editingId, editDraft, setEditDraft, startEdit, cancelEdit, saveEdit };
}
