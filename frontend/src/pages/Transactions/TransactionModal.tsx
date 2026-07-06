import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Account, Category, Transaction } from '../../api/types';
import { formatDate, parseUserDate } from '../../lib/format';
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
  const qc = useQueryClient();
  // We hold the date in the FRENCH textual form (JJ/MM/AAAA) and parse to
  // ISO only at submit time. This lets the user paste "14/07/2025"
  // straight from a bank statement without fighting the picker.
  const todayFr = formatDate(new Date().toISOString().slice(0, 10));
  const isEdit = !!transaction;

  const [accountId, setAccountId] = useState<number | ''>('');
  const [date, setDate] = useState(todayFr);
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
      setDate(todayFr);
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

  const cleanedAmountForSplit = amount.replace(/€/g, '').replace(/\s+/g, '').replace(',', '.').trim();
  const parentCents = /^-?\d+(\.\d{1,2})?$/.test(cleanedAmountForSplit)
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
          return {
            categoryId: r.categoryId === '' ? 0 : r.categoryId,
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
      const res = await api<{ transaction: Transaction }>(`/api/transactions/${input.id}`, {
        method: 'PATCH', json: input.patch,
      });
      await persistSplits(input.id);
      return res;
    },
    onSuccess: () => { invalidate(); onClose(); },
    onError: (err: ApiError) => setError(err.message),
  });

  if (!open) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!accountId) {
      setError('Choisissez un compte.');
      return;
    }
    const isoDate = parseUserDate(date);
    if (!isoDate) {
      setError('Date invalide. Format attendu : JJ/MM/AAAA (ex. 14/07/2025).');
      return;
    }
    const cleanedAmount = amount.replace(/€/g, '').replace(/\s+/g, '').replace(',', '.').trim();
    if (!/^-?\d+(\.\d{1,2})?$/.test(cleanedAmount)) {
      setError('Montant invalide. Format attendu : 338.50, -25,30, 1234, …');
      return;
    }
    if (!rawLabel.trim()) {
      setError('Le libellé est obligatoire.');
      return;
    }
    const lockRaw = lockYearsInput.trim();
    let lockYears: number | null = null;
    if (lockRaw !== '') {
      const n = Number(lockRaw);
      if (!Number.isInteger(n) || n < 0 || n > 99) {
        setError('Blocage : entier entre 0 et 99, ou laisser vide.');
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

      if (Object.keys(patch).length === 0) {
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
          {isEdit ? 'Modifier la transaction' : 'Nouvelle transaction'}
        </div>
        <div className="text-sm text-ink-400 mb-5">
          {isEdit
            ? 'Le dedup_key reste figé : un re-import du fichier source ne créera pas de doublon.'
            : 'Saisie manuelle. Le moteur de règles s\'appliquera automatiquement si vous laissez la catégorie vide.'}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="label mb-1.5 block">Compte</label>
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
            <label className="label mb-1.5 block">Date</label>
            <input
              type="text"
              inputMode="numeric"
              className="input font-mono"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              placeholder="JJ/MM/AAAA"
              required
              autoComplete="off"
            />
            <div className="text-[11px] text-ink-500 mt-1">
              Format JJ/MM/AAAA — collage direct depuis un relevé bancaire accepté.
            </div>
          </div>
          <div>
            <label className="label mb-1.5 block">Montant</label>
            <input
              className="input font-mono"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="-25,30"
              required
            />
            <div className="text-[11px] text-ink-500 mt-1">
              Signé : négatif = dépense, positif = revenu.
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="label mb-1.5 block">Libellé</label>
            <input
              className="input"
              value={rawLabel}
              onChange={(e) => setRawLabel(e.target.value)}
              placeholder="Carrefour Évry"
              required
            />
          </div>
          <div>
            <label className="label mb-1.5 block">Catégorie (optionnelle)</label>
            <select
              className="input"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">— (auto via règles)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label mb-1.5 block">Notes</label>
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
              title="Bloque UNIQUEMENT cette transaction pendant N ans à partir de sa date (dépôts à terme / Natixis). Laisser vide pour un PEA : la transaction hérite alors du verrou global du compte (date d'ouverture + N ans, une seule échéance pour tout le compte)."
            >
              Blocage individuel (ans) <span className="text-ink-500 font-normal">— optionnel</span>
            </label>
            <input
              type="number"
              min={0}
              max={99}
              className="input font-mono"
              value={lockYearsInput}
              onChange={(e) => setLockYearsInput(e.target.value)}
              placeholder="—"
            />
            <div className="text-[11px] text-ink-500 mt-1">
              {selectedAccount?.lockYears == null
                ? 'Le compte n\'a pas de blocage. Remplissez seulement si cette transaction doit être bloquée N ans depuis sa date.'
                : `PEA : laissez vide, la transaction hérite du verrou global (${selectedAccount.lockYears} ans depuis l'ouverture du compte). Dépôt à terme (Natixis) : remplissez avec ${selectedAccount.lockYears} pour que cette échéance soit calculée depuis la date de la transaction.`}
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
            Annuler
          </button>
          <button type="submit" className="btn-primary" disabled={pending || splitsInvalid}>
            {pending
              ? isEdit ? 'Enregistrement…' : 'Création…'
              : isEdit ? 'Enregistrer' : 'Créer la transaction'}
          </button>
        </div>
      </form>
    </div>
  );
}
