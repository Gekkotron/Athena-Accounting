import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Transaction } from '../../api/types';
import { parseMagnitudeCents, type DraftSplit } from './SplitEditor';
import type { TxPatch } from './transaction-modal-lib';

export function useTransactionModalMutations({
  transaction,
  splitsDraft,
  parentCents,
  onClose,
}: {
  transaction: Transaction | null;
  splitsDraft: DraftSplit[];
  parentCents: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  // Parent POST succeeded but the follow-up splits PUT failed. Set once, the
  // "Create" button is locked so re-clicking cannot mint a duplicate parent
  // server-side; the user has to close and re-open the transaction from the
  // list (the invalidate below has already refreshed it) to retry the splits.
  const [createdTxIdOnFailure, setCreatedTxIdOnFailure] = useState<number | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
    qc.invalidateQueries({ queryKey: ['reports'] });
    qc.invalidateQueries({ queryKey: ['tri-groups'] });
  };

  async function persistSplits(txId: number): Promise<void> {
    const sign = parentCents < 0 ? -1 : 1;
    if (splitsDraft.length === 0) {
      // Only DELETE when we're editing a previously-split transaction.
      if (transaction && transaction.splits.length > 0) {
        await api(`/api/transactions/${txId}/splits`, { method: 'DELETE' });
      }
      return;
    }
    await api(`/api/transactions/${txId}/splits`, {
      method: 'PUT',
      json: {
        splits: splitsDraft.map((r) => {
          const cents = parseMagnitudeCents(r.amountMagnitude) ?? 0;
          if (r.categoryId === '') {
            throw new Error('invariant: persistSplits reached with empty categoryId (splitsInvalid guard failed)');
          }
          return {
            categoryId: r.categoryId,
            amount: ((cents * sign) / 100).toFixed(2),
            memo: r.memo.trim() ? r.memo : null,
          };
        }),
      },
    });
  }

  const create = useMutation({
    mutationFn: async (input: {
      accountId: number;
      date: string;
      amount: string;
      rawLabel: string;
      categoryId: number | null;
      notes: string | null;
      lockYears: number | null;
    }) => {
      const { transaction: tx } = await api<{ transaction: Transaction }>('/api/transactions', {
        method: 'POST', json: input,
      });
      try {
        await persistSplits(tx.id);
      } catch (err) {
        // Parent already committed server-side. Refresh the list so the row
        // shows up and remember the id — the onError handler uses it to
        // switch the modal into a "close-only" mode so re-submitting cannot
        // create a second parent transaction.
        invalidate();
        setCreatedTxIdOnFailure(tx.id);
        throw err;
      }
      return { transaction: tx };
    },
    onSuccess: () => { invalidate(); onClose(); },
    onError: (err: unknown) => {
      const message = err instanceof ApiError || err instanceof Error ? err.message : String(err);
      setError(message);
    },
  });

  const update = useMutation({
    mutationFn: async (input: { id: number; patch: TxPatch }) => {
      // Skip the PATCH when the parent has no field changes — splits alone
      // might be what changed, and we still want to hit persistSplits below.
      // An empty PATCH body would 400.
      if (Object.keys(input.patch).length > 0) {
        await api<{ transaction: Transaction }>(`/api/transactions/${input.id}`, {
          method: 'PATCH', json: input.patch,
        });
      }
      await persistSplits(input.id);
    },
    onSuccess: () => { invalidate(); onClose(); },
    onError: (err: ApiError) => setError(err.message),
  });

  const pending = create.isPending || update.isPending;
  const resetErrorState = () => { setError(null); setCreatedTxIdOnFailure(null); };

  return { error, setError, createdTxIdOnFailure, resetErrorState, create, update, pending };
}
