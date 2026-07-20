import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Account, Category, Transaction } from '../../api/types';
import { formatDate, parseDecimal, parseUserDate } from '../../lib/format';
import { SplitEditor, type DraftSplit, parseMagnitudeCents, fromInitial } from './SplitEditor';
import { TransactionModalFields } from './TransactionModalFields';
import {
  buildPatchDiff,
  draftMatchesInitial,
  parseLockYearsInput,
  type TxPatch,
} from './transaction-modal-lib';

export function TransactionModal({
  open,
  transaction,
  onClose,
  accounts,
  categories,
}: {
  open: boolean;
  // null = create mode; populated = edit mode.
  transaction: Transaction | null;
  onClose: () => void;
  accounts: Account[];
  categories: Category[];
}) {
  const { t } = useTranslation(['transactions', 'common']);
  const qc = useQueryClient();
  // Date is held in the FRENCH textual form (JJ/MM/AAAA) and parsed to ISO
  // only at submit time. Lets the user paste "14/07/2025" straight from a
  // bank statement without fighting the picker.
  const isEdit = !!transaction;
  const byId = useMemo(
    () => new Map(categories.map((c) => [c.id, c] as const)),
    [categories],
  );

  const [accountId, setAccountId] = useState<number | ''>('');
  // Blank by default in create mode: pre-filling today's date silently
  // stamped new transactions with the wrong day whenever the user forgot to
  // overwrite it. Empty forces a deliberate entry.
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [rawLabel, setRawLabel] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  // Empty = inherit account default; any digit = this tx locks for N years
  // from ITS OWN date (Natixis-style rolling-lock).
  const [lockYearsInput, setLockYearsInput] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [splitsDraft, setSplitsDraft] = useState<DraftSplit[]>([]);

  useEffect(() => {
    if (!open) return;
    if (transaction) {
      setAccountId(transaction.accountId);
      setDate(formatDate(transaction.date.slice(0, 10)));
      setAmount(transaction.amount);
      setRawLabel(transaction.rawLabel);
      setCategoryId(transaction.categoryId ?? '');
      setNotes(transaction.notes ?? '');
      setLockYearsInput(transaction.lockYears == null ? '' : String(transaction.lockYears));
      setSplitsDraft(fromInitial(transaction.splits));
    } else {
      setAccountId(accounts[0]?.id ?? '');
      setDate('');
      setAmount('');
      setRawLabel('');
      setCategoryId('');
      setNotes('');
      // Blank on create so PEA (single-clock envelope) semantics kick in:
      // deposits inherit openingDate + N years. On a Natixis-style account
      // the user types a per-deposit year count; pre-filling would silently
      // switch PEA semantics to rolling-lock.
      setLockYearsInput('');
      setSplitsDraft([]);
    }
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
    qc.invalidateQueries({ queryKey: ['reports'] });
    qc.invalidateQueries({ queryKey: ['tri-groups'] });
  };

  const cleanedAmountForSplit = parseDecimal(amount);
  const parentCents = cleanedAmountForSplit !== null
    ? Math.round(Number(cleanedAmountForSplit) * 100)
    : 0;
  const parentAmountMagnitude = Math.abs(parentCents) / 100;
  const parentAmountSign: -1 | 1 | 0 =
    parentCents === 0 ? 0 : parentCents < 0 ? -1 : 1;
  const isTransfer = transaction?.transferGroupId != null;

  const splitsSumCents = splitsDraft.reduce((acc, r) => {
    const cents = parseMagnitudeCents(r.amountMagnitude);
    return acc + (cents ?? 0);
  }, 0);
  const remainderCents = Math.abs(parentCents) - splitsSumCents;
  const splitsInvalid = splitsDraft.length > 0 && (
    remainderCents !== 0 ||
    splitsDraft.some((r) => {
      if (r.categoryId === '') return true;
      const cents = parseMagnitudeCents(r.amountMagnitude);
      return cents === null || cents === 0;
    })
  );

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
      await persistSplits(tx.id);
      return { transaction: tx };
    },
    onSuccess: () => { invalidate(); onClose(); },
    onError: (err: ApiError) => setError(err.message),
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

  if (!open) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!accountId) {
      setError(t('modal.errors.accountRequired'));
      return;
    }
    const isoDate = parseUserDate(date);
    if (!isoDate) {
      setError(t('modal.errors.invalidDate'));
      return;
    }
    const cleanedAmount = parseDecimal(amount);
    if (cleanedAmount === null) {
      setError(t('modal.errors.invalidAmount'));
      return;
    }
    if (!rawLabel.trim()) {
      setError(t('modal.errors.labelRequired'));
      return;
    }
    const lockParsed = parseLockYearsInput(lockYearsInput);
    if (!lockParsed.ok) {
      setError(t('modal.errors.invalidLockYears'));
      return;
    }

    if (isEdit && transaction) {
      const patch = buildPatchDiff(transaction, {
        accountId,
        isoDate,
        amount: cleanedAmount,
        rawLabel,
        categoryId,
        notes,
        lockYears: lockParsed.value,
      });
      // Splits go through update even if no parent field moved — otherwise
      // adding a ventilation to an untouched transaction would silently
      // close the modal without persisting.
      if (Object.keys(patch).length === 0 && draftMatchesInitial(splitsDraft, transaction.splits, parentCents)) {
        onClose();
        return;
      }
      update.mutate({ id: transaction.id, patch });
    } else {
      create.mutate({
        accountId,
        date: isoDate,
        amount: cleanedAmount,
        rawLabel: rawLabel.trim(),
        categoryId: categoryId || null,
        notes: notes.trim() || null,
        lockYears: lockParsed.value,
      });
    }
  };

  const selectedAccount = accountId ? accounts.find((a) => a.id === accountId) : undefined;
  const pending = create.isPending || update.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-ink-950/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        className="surface w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="display text-xl text-ink-50 mb-1">
          {isEdit ? t('modal.header.edit') : t('modal.header.create')}
        </div>
        <div className="text-sm text-ink-400 mb-5">
          {isEdit ? t('modal.header.editHint') : t('modal.header.createHint')}
        </div>

        <TransactionModalFields
          accounts={accounts}
          categories={categories}
          categoryById={byId}
          accountId={accountId}
          onAccountIdChange={setAccountId}
          date={date}
          onDateChange={setDate}
          amount={amount}
          onAmountChange={setAmount}
          rawLabel={rawLabel}
          onRawLabelChange={setRawLabel}
          categoryId={categoryId}
          onCategoryIdChange={setCategoryId}
          notes={notes}
          onNotesChange={setNotes}
          lockYearsInput={lockYearsInput}
          onLockYearsInputChange={setLockYearsInput}
          selectedAccountLockYears={selectedAccount?.lockYears ?? null}
        />

        <SplitEditor
          parentAmountMagnitude={parentAmountMagnitude}
          parentAmountSign={parentAmountSign}
          disabled={isTransfer}
          initial={transaction?.splits ?? []}
          resetKey={transaction?.id ?? 'new'}
          categories={categories}
          onChange={setSplitsDraft}
        />

        {error && (
          <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200 mt-4">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={pending}>
            {t('cancel', { ns: 'common' })}
          </button>
          <button type="submit" className="btn-primary" disabled={pending || splitsInvalid}>
            {pending
              ? isEdit ? t('modal.actions.saving') : t('modal.actions.creating')
              : isEdit ? t('save', { ns: 'common' }) : t('modal.actions.create')}
          </button>
        </div>
      </form>
    </div>
  );
}
