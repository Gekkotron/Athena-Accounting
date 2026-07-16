import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Account, Category, Transaction } from '../../api/types';
import { formatDate, parseDecimal, parseUserDate } from '../../lib/format';
import { formatCategoryPath } from '../../lib/categories';
import { SplitEditor, type DraftSplit, parseMagnitudeCents, fromInitial } from './SplitEditor';

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
  // We hold the date in the FRENCH textual form (JJ/MM/AAAA) and parse to
  // ISO only at submit time. This lets the user paste "14/07/2025"
  // straight from a bank statement without fighting the picker.
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
  // Empty string = no per-tx override; the transaction inherits the account
  // default (which itself may be null = never locked). Any digit here means
  // this transaction locks for N years from ITS OWN date — the Natixis-style
  // rolling-lock semantics.
  const [lockYearsInput, setLockYearsInput] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [splitsDraft, setSplitsDraft] = useState<DraftSplit[]>([]);

  // Re-seed defaults / draft from the target transaction whenever the modal
  // opens or the target changes.
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
      // Field stays BLANK by default. On a PEA (single-clock envelope) the
      // user wants each deposit to inherit the account-wide unlock date
      // (openingDate + N years), which happens automatically when
      // tx.lockYears is null. On a term-deposit-style account (Natixis) the
      // user types the year count per deposit — pre-filling would silently
      // switch PEA semantics to rolling-lock, which is wrong.
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
          const categoryIdForPayload = r.categoryId;
          return {
            categoryId: categoryIdForPayload,
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
    mutationFn: async (input: {
      id: number;
      patch: Partial<{
        accountId: number;
        date: string;
        amount: string;
        rawLabel: string;
        categoryId: number | null;
        notes: string | null;
        lockYears: number | null;
      }>;
    }) => {
      // Skip the PATCH when the parent transaction has no field changes —
      // splits alone might be what changed, and we still want to hit
      // persistSplits below. Without this, an empty PATCH body would 400.
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
    const lockRaw = lockYearsInput.trim();
    let lockYears: number | null = null;
    if (lockRaw !== '') {
      const n = Number(lockRaw);
      if (!Number.isInteger(n) || n < 0 || n > 99) {
        setError(t('modal.errors.invalidLockYears'));
        return;
      }
      lockYears = n;
    }

    if (isEdit && transaction) {
      // Diff against the original so the PATCH only sends fields that changed.
      const patch: Partial<{
        accountId: number;
        date: string;
        amount: string;
        rawLabel: string;
        categoryId: number | null;
        notes: string | null;
        lockYears: number | null;
      }> = {};
      if (accountId !== transaction.accountId) patch.accountId = accountId;
      if (isoDate !== transaction.date.slice(0, 10)) patch.date = isoDate;
      if (cleanedAmount !== transaction.amount) patch.amount = cleanedAmount;
      if (rawLabel.trim() !== transaction.rawLabel) patch.rawLabel = rawLabel.trim();
      if ((categoryId || null) !== transaction.categoryId) {
        patch.categoryId = categoryId || null;
      }
      const cleanedNotes = notes.trim() || null;
      if (cleanedNotes !== transaction.notes) patch.notes = cleanedNotes;
      if (lockYears !== (transaction.lockYears ?? null)) {
        patch.lockYears = lockYears;
      }

      // Split changes must go through the mutation even when no parent field
      // moved — otherwise adding a ventilation to an untouched transaction
      // would silently close the modal without persisting.
      const initialSplits = transaction.splits;
      const sign = parentCents < 0 ? -1 : 1;
      const draftMatchesInitial =
        initialSplits.length === splitsDraft.length &&
        splitsDraft.every((r, i) => {
          const init = initialSplits[i];
          if (r.categoryId === '') return false;
          if (init.categoryId !== r.categoryId) return false;
          const draftSignedCents = (parseMagnitudeCents(r.amountMagnitude) ?? 0) * sign;
          const initCents = Math.round(Number(init.amount) * 100);
          if (draftSignedCents !== initCents) return false;
          const draftMemo = r.memo.trim() || null;
          const initMemo = init.memo && init.memo.trim() ? init.memo : null;
          return draftMemo === initMemo;
        });
      if (Object.keys(patch).length === 0 && draftMatchesInitial) {
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
        lockYears,
      });
    }
  };

  // Pre-fill lock years when the user switches account mid-modal to a
  // different one — but only in create mode, and only if they haven't
  // already typed a custom value.
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="label mb-1.5 block">{t('modal.labels.account')}</label>
            <select
              className="input"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : '')}
              required
            >
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label mb-1.5 block">{t('modal.labels.date')}</label>
            <input
              type="text"
              inputMode="numeric"
              className="input font-mono"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              placeholder={t('modal.placeholders.date')}
              required
              autoComplete="off"
            />
            <div className="text-[11px] text-ink-500 mt-1">
              {t('modal.hints.dateFormat')}
            </div>
          </div>
          <div>
            <label className="label mb-1.5 block">{t('modal.labels.amount')}</label>
            <input
              className="input font-mono"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t('modal.placeholders.amount')}
              required
            />
            <div className="text-[11px] text-ink-500 mt-1">
              {t('modal.hints.amountSign')}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="label mb-1.5 block">{t('modal.labels.label')}</label>
            <input
              className="input"
              value={rawLabel}
              onChange={(e) => setRawLabel(e.target.value)}
              placeholder={t('modal.placeholders.label')}
              required
            />
          </div>
          <div>
            <label className="label mb-1.5 block">{t('modal.labels.categoryOptional')}</label>
            <select
              className="input"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">{t('modal.options.categoryAuto')}</option>
              {[...categories]
                .sort((a, b) => {
                  const pa = a.parentId != null ? byId.get(a.parentId)?.name ?? '' : a.name;
                  const pb = b.parentId != null ? byId.get(b.parentId)?.name ?? '' : b.name;
                  return pa.localeCompare(pb) || a.name.localeCompare(b.name);
                })
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {formatCategoryPath(c, byId)}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="label mb-1.5 block">{t('modal.labels.notes')}</label>
            <input
              className="input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="…"
            />
          </div>
          <div className="sm:col-span-2">
            <label
              className="label mb-1.5 block"
              title={t('modal.hints.lockYearsTooltip')}
            >
              {t('modal.labels.lockYears')} <span className="text-ink-500 font-normal">{t('modal.labels.optional')}</span>
            </label>
            <input
              inputMode="numeric"
              className="input font-mono"
              value={lockYearsInput}
              onChange={(e) => setLockYearsInput(e.target.value)}
              placeholder="—"
            />
            <div className="text-[11px] text-ink-500 mt-1">
              {selectedAccount?.lockYears == null
                ? t('modal.hints.lockYearsNoAccountLock')
                : t('modal.hints.lockYearsWithAccountLock', { years: selectedAccount.lockYears })}
            </div>
          </div>
        </div>

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
