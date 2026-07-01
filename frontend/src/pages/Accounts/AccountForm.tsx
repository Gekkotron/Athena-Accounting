import { useState, type FormEvent } from 'react';

export interface AccountFormValues {
  name: string;
  type: string;
  currency: string;
  openingBalance: string;
  openingDate: string;
}

export function AccountForm({
  mode,
  initial,
  onSubmit,
  onCancel,
  onDelete,
  submitting,
  error,
}: {
  mode: 'create' | 'edit';
  initial?: Partial<AccountFormValues>;
  onSubmit: (values: AccountFormValues) => void;
  onCancel?: () => void;
  onDelete?: () => void;
  submitting?: boolean;
  error?: string | null;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState(initial?.type ?? 'checking');
  const [currency, setCurrency] = useState(initial?.currency ?? 'EUR');
  const [openingBalance, setOpeningBalance] = useState(initial?.openingBalance ?? '0.00');
  const [openingDate, setOpeningDate] = useState(
    initial?.openingDate ?? new Date().toISOString().slice(0, 10)
  );

  const values: AccountFormValues = { name, type, currency, openingBalance, openingDate };

  if (mode === 'create') {
    const submit = (e: FormEvent) => {
      e.preventDefault();
      onSubmit(values);
    };

    return (
      <form onSubmit={submit} className="surface p-5 md:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        <div className="lg:col-span-2">
          <label className="label mb-1.5 block">Nom</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label mb-1.5 block">Type</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="checking">Courant</option>
            <option value="savings">Épargne</option>
            <option value="credit">Crédit</option>
            <option value="other">Autre</option>
          </select>
        </div>
        <div>
          <label className="label mb-1.5 block">Devise</label>
          <input
            className="input"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            required
          />
        </div>
        <div>
          <label className="label mb-1.5 block">Solde d'ouverture</label>
          <input
            className="input font-mono"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label mb-1.5 block">Date d'ouverture</label>
          <input
            type="date"
            className="input"
            value={openingDate}
            onChange={(e) => setOpeningDate(e.target.value)}
            required
          />
        </div>
        {error && (
          <div className="sm:col-span-2 lg:col-span-6 rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
            {error}
          </div>
        )}
        <div className="sm:col-span-2 lg:col-span-6">
          <button className="btn-primary" disabled={submitting}>
            {submitting ? 'Création…' : 'Créer le compte'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="label mb-1 block">Nom</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label mb-1 block">Type</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="checking">Courant</option>
            <option value="savings">Épargne</option>
            <option value="credit">Crédit</option>
            <option value="other">Autre</option>
          </select>
        </div>
        <div>
          <label className="label mb-1 block">Devise</label>
          <input
            className="input"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
          />
        </div>
      </div>
      <div>
        <label className="label mb-1 block">Solde d'ouverture</label>
        <input
          className="input font-mono"
          value={openingBalance}
          onChange={(e) => setOpeningBalance(e.target.value)}
        />
        <div className="text-[11px] text-ink-500 mt-1">
          Modifier ce montant ajustera automatiquement le solde courant.
        </div>
      </div>
      <div>
        <label className="label mb-1 block">Date d'ouverture</label>
        <input
          type="date"
          className="input"
          value={openingDate}
          onChange={(e) => setOpeningDate(e.target.value)}
        />
      </div>
      {error && (
        <div className="rounded-md border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-xs text-clay-200">
          {error}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 pt-1">
        {onDelete ? (
          <button className="text-[11px] text-clay-300 hover:text-clay-200 transition" onClick={onDelete}>
            supprimer
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={onCancel}>
            Annuler
          </button>
          <button className="btn-primary" onClick={() => onSubmit(values)} disabled={submitting}>
            {submitting ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}
