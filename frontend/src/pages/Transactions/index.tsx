import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Account, Category, Transaction } from '../../api/types';
import { formatDate, parseUserDate } from '../../lib/format';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TransactionsTable } from './TransactionsTable';
import { FiltersBar } from './FiltersBar';

export interface Filters {
  accountId?: number;
  categoryId?: number;
  fromDate?: string;
  toDate?: string;
  search?: string;
  amount?: string;
  sort: 'date' | 'amount' | 'label';
  order: 'asc' | 'desc';
}

const PAGE = 50;

// Try to interpret a search input as an amount. Accepts "338", "338€",
// "338,50", "338.50", "338,50 €", with optional leading minus. Returns the
// canonical "X.XX" form, or null when it's not a number.
function parseAmountQuery(raw: string): string | null {
  const cleaned = raw
    .replace(/€/g, '')
    .replace(/\s+/g, '')
    .replace(',', '.')
    .trim();
  if (!cleaned) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return cleaned;
}

export function Transactions() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  // Pick up an optional ?accountId=… from the URL so links from the dashboard
  // land on the right pre-filtered view.
  const initialAccountId = (() => {
    const v = searchParams.get('accountId');
    if (!v) return undefined;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  })();
  const [filters, setFilters] = useState<Filters>({
    sort: 'date',
    order: 'desc',
    accountId: initialAccountId,
  });
  const [searchInput, setSearchInput] = useState('');
  const [offset, setOffset] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  // null means "create"; a Transaction means "edit"; undefined means "closed".
  const [modalTx, setModalTx] = useState<Transaction | null | undefined>(undefined);
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Whenever the search input changes, route it to either `amount` or
  // `search`. We never send both at once.
  const onSearchChange = (value: string) => {
    setSearchInput(value);
    setOffset(0);
    const amt = parseAmountQuery(value);
    if (amt !== null) {
      setFilters((f) => ({ ...f, amount: amt, search: undefined }));
    } else {
      setFilters((f) => ({ ...f, amount: undefined, search: value || undefined }));
    }
  };

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const categoriesQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });

  const txQ = useQuery({
    queryKey: ['transactions', filters, offset],
    queryFn: () =>
      api<{
        transactions: Transaction[];
        pagination: { total: number; limit: number; offset: number };
      }>('/api/transactions', {
        query: { ...filters, limit: PAGE, offset },
      }),
  });

  const updateCategory = useMutation({
    mutationFn: ({ id, categoryId }: { id: number; categoryId: number | null }) =>
      api<{ transaction: Transaction }>(`/api/transactions/${id}`, {
        method: 'PATCH',
        json: { categoryId },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions'] }),
  });

  const updateNotes = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string | null }) =>
      api<{ transaction: Transaction }>(`/api/transactions/${id}`, {
        method: 'PATCH',
        json: { notes },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions'] }),
  });

  const deleteTransaction = useMutation({
    mutationFn: (id: number) => api(`/api/transactions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['tri-groups'] });
      setDeletingTx(null);
      setDeleteError(null);
    },
    onError: (err: ApiError) => setDeleteError(err.message),
  });

  const accounts = accountsQ.data?.accounts ?? [];
  const categories = categoriesQ.data?.categories ?? [];
  const txs = txQ.data?.transactions ?? [];
  const total = txQ.data?.pagination.total ?? 0;

  const accountById = new Map(accounts.map((a) => [a.id, a] as const));

  return (
    <div className="flex flex-col gap-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Transactions</h1>
          <p className="page-subtitle">{total.toLocaleString('fr-FR')} ligne{total > 1 ? 's' : ''} au total</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary md:hidden" onClick={() => setShowFilters((s) => !s)}>
            {showFilters ? 'Masquer' : 'Filtres'}
          </button>
          <button className="btn-primary" onClick={() => setModalTx(null)}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Nouvelle transaction
          </button>
        </div>
      </div>

      <FiltersBar
        filters={filters}
        searchInput={searchInput}
        accounts={accounts}
        categories={categories}
        showAdvanced={showFilters}
        onToggleAdvanced={() => setShowFilters((s) => !s)}
        onFilterChange={(patch) => {
          setOffset(0);
          setFilters((f) => ({ ...f, ...patch }));
        }}
        onSearchInputChange={onSearchChange}
      />

      <TransactionsTable
        transactions={txs}
        categories={categories}
        accountById={accountById}
        isLoading={txQ.isLoading}
        filters={filters}
        setFilters={setFilters}
        setOffset={setOffset}
        onUpdateCategory={(id, patch) => updateCategory.mutate({ id, ...patch })}
        onUpdateNotes={(id, patch) => updateNotes.mutate({ id, ...patch })}
        onEdit={(tx) => setModalTx(tx)}
        onDelete={(tx) => {
          setDeleteError(null);
          setDeletingTx(tx);
        }}
      />

      <div className="flex items-center justify-between text-sm text-ink-400">
        <div className="font-mono text-xs">
          {total === 0 ? '0–0' : `${offset + 1}–${Math.min(offset + PAGE, total)}`} sur {total}
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            ‹
          </button>
          <button className="btn-secondary" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
            ›
          </button>
        </div>
      </div>

      <TransactionModal
        // modalTx undefined = closed; null = create; Transaction = edit.
        open={modalTx !== undefined}
        transaction={modalTx ?? null}
        onClose={() => setModalTx(undefined)}
        accounts={accounts}
        categories={categories}
      />

      <ConfirmDialog
        open={!!deletingTx}
        title={
          deletingTx
            ? `Supprimer la transaction « ${truncate(deletingTx.rawLabel, 40)} » ?`
            : ''
        }
        description={
          <>
            Cette action est <span className="display-italic">irréversible</span>. Si la
            transaction fait partie d'un virement interne, la jambe miroir est délinkée
            (transfer_group_id mis à null) pour ne pas devenir invisible dans les agrégats.
          </>
        }
        confirmLabel="Supprimer la transaction"
        destructive
        busy={deleteTransaction.isPending}
        error={deleteError}
        onConfirm={() => deletingTx && deleteTransaction.mutate(deletingTx.id)}
        onCancel={() => {
          setDeletingTx(null);
          setDeleteError(null);
        }}
      />
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function TransactionModal({
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
  const [error, setError] = useState<string | null>(null);

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
    } else {
      setAccountId(accounts[0]?.id ?? '');
      setDate(todayFr);
      setAmount('');
      setRawLabel('');
      setCategoryId('');
      setNotes('');
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

  const create = useMutation({
    mutationFn: (input: {
      accountId: number;
      date: string;
      amount: string;
      rawLabel: string;
      categoryId: number | null;
      notes: string | null;
    }) =>
      api<{ transaction: Transaction }>('/api/transactions', {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err: ApiError) => setError(err.message),
  });

  const update = useMutation({
    mutationFn: (input: {
      id: number;
      patch: Partial<{
        accountId: number;
        date: string;
        amount: string;
        rawLabel: string;
        categoryId: number | null;
        notes: string | null;
      }>;
    }) =>
      api<{ transaction: Transaction }>(`/api/transactions/${input.id}`, {
        method: 'PATCH',
        json: input.patch,
      }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
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

    if (isEdit && transaction) {
      // Diff against the original so the PATCH only sends fields that changed.
      const patch: Partial<{
        accountId: number;
        date: string;
        amount: string;
        rawLabel: string;
        categoryId: number | null;
        notes: string | null;
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
      });
    }
  };

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
        </div>

        {error && (
          <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200 mt-4">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={pending}>
            Annuler
          </button>
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending
              ? isEdit ? 'Enregistrement…' : 'Création…'
              : isEdit ? 'Enregistrer' : 'Créer la transaction'}
          </button>
        </div>
      </form>
    </div>
  );
}
