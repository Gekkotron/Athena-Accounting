import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Account, Category, Transaction } from '../../api/types';
import { formatDate, parseDecimal } from '../../lib/format';
import { SplitEditor, type DraftSplit, parseMagnitudeCents, fromInitial } from './SplitEditor';
import { TransactionModalFields } from './TransactionModalFields';
import { TransactionAttachments } from './TransactionAttachments';
import { decideSubmitAction } from './transaction-modal-lib';
import { useTransactionModalMutations } from './useTransactionModalMutations';

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
  const [splitsDraft, setSplitsDraft] = useState<DraftSplit[]>([]);

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

  const { error, setError, createdTxIdOnFailure, resetErrorState, create, update, pending } =
    useTransactionModalMutations({ transaction, splitsDraft, parentCents, onClose });

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
    resetErrorState();
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

  if (!open) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const action = decideSubmitAction(
      { accountId, date, amount, rawLabel, categoryId, notes, lockYearsInput },
      transaction, splitsDraft, parentCents,
    );
    switch (action.kind) {
      case 'error': setError(t(`modal.errors.${action.messageKey}`)); return;
      case 'noop': onClose(); return;
      case 'update': update.mutate({ id: action.id, patch: action.patch }); return;
      case 'create': create.mutate(action.input); return;
    }
  };

  const selectedAccount = accountId ? accounts.find((a) => a.id === accountId) : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-ink-950/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        className="surface w-full max-w-lg max-h-[90vh] flex flex-col p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="display text-xl text-ink-50 mb-1">
          {isEdit ? t('modal.header.edit') : t('modal.header.create')}
        </div>
        <div className="text-sm text-ink-400 mb-5">
          {isEdit ? t('modal.header.editHint') : t('modal.header.createHint')}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6 pb-2">
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
          parentAmountMagnitude={parentAmountMagnitude} parentAmountSign={parentAmountSign}
          disabled={isTransfer}
          initial={transaction?.splits ?? []}
          resetKey={transaction?.id ?? 'new'}
          categories={categories}
          onChange={setSplitsDraft}
          splitsSource={transaction?.splitsSource ?? null}
        />

        <TransactionAttachments transactionId={transaction?.id ?? null} />

        {(error || createdTxIdOnFailure != null) && (
          <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200 mt-4">
            {createdTxIdOnFailure != null
              ? t('modal.errors.createdButSplitsFailed', { message: error ?? '' })
              : error}
          </div>
        )}
        </div>

        <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-ink-800/60">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={pending}>
            {createdTxIdOnFailure != null ? t('close', { ns: 'common' }) : t('cancel', { ns: 'common' })}
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={pending || splitsInvalid || createdTxIdOnFailure != null}
          >
            {pending
              ? isEdit ? t('modal.actions.saving') : t('modal.actions.creating')
              : isEdit ? t('save', { ns: 'common' }) : t('modal.actions.create')}
          </button>
        </div>
      </form>
    </div>
  );
}
