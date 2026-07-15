import { useEffect, useMemo, useState } from 'react';
import type {
  Account, Budget, BudgetPeriod, BudgetReport, Category,
} from '../../api/types';
import { formatCategoryPath } from '../../lib/categories';
import { formatAmount, parseDecimal } from '../../lib/format';

// Returns the canonical "X" / "X.YY" form when v parses as a strictly positive
// amount (comma OR period accepted), else null.
function normalizeLimit(v: string): string | null {
  const cleaned = parseDecimal(v);
  if (cleaned === null) return null;
  return Number(cleaned) > 0 ? cleaned : null;
}

export function AddBudgetForm(props: {
  categories: Category[];
  accounts: Account[];
  budgets: Budget[];
  candidates: BudgetReport['unbudgetedCandidates'];
  prefill: { categoryId: number; suggested: string } | null;
  onSubmit: (body: {
    categoryId: number; monthlyLimit: string;
    period: BudgetPeriod; accountId: number | null;
  }) => void;
  isPending: boolean;
}): JSX.Element {
  const { categories, accounts, budgets, candidates, prefill, onSubmit, isPending } = props;

  const [catId, setCatId] = useState('');
  const [limit, setLimit] = useState('');
  const [period, setPeriod] = useState<BudgetPeriod>('monthly');
  const [accountId, setAccountId] = useState<string>('');
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c] as const)), [categories]);

  useEffect(() => {
    if (prefill) {
      setCatId(String(prefill.categoryId));
      setLimit(prefill.suggested);
    }
  }, [prefill]);

  const budgetedIds = useMemo(() => new Set(
    budgets.filter((b) => b.period === period && (b.accountId ?? null) === (accountId ? Number(accountId) : null))
           .map((b) => b.categoryId),
  ), [budgets, period, accountId]);

  const addable = useMemo(() => categories.filter(
    (c) => c.kind === 'expense' && !budgetedIds.has(c.id),
  ), [categories, budgetedIds]);

  const suggestedFor = (id: number): string | undefined =>
    candidates.find((c) => c.categoryId === id)?.average;

  const placeholder = (() => {
    if (!catId) return 'Plafond €';
    const s = suggestedFor(Number(catId));
    if (!s) return 'Plafond €';
    const suffix = period === 'monthly' ? '/mois' : '/an';
    return `≈ ${formatAmount(s)} €${suffix}`;
  })();

  const submit = () => {
    const categoryId = Number(catId);
    const monthlyLimit = normalizeLimit(limit);
    if (!categoryId || monthlyLimit === null) return;
    onSubmit({
      categoryId,
      monthlyLimit,
      period,
      accountId: accountId ? Number(accountId) : null,
    });
    setCatId(''); setLimit(''); setAccountId('');
  };

  return (
    <div id="budgets-add-form" className="surface p-4 flex flex-col gap-3">
      <div className="label">Ajouter un budget</div>
      {addable.length === 0 ? (
        <p className="text-sm text-ink-500">
          Toutes vos catégories de dépense ont déjà un plafond pour ce contexte.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-1">
              <input
                type="radio" name="period"
                checked={period === 'monthly'}
                onChange={() => setPeriod('monthly')}
              />
              Mensuel
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio" name="period"
                checked={period === 'yearly'}
                onChange={() => setPeriod('yearly')}
              />
              Annuel
            </label>
          </div>

          <div className="flex items-end gap-2 flex-wrap">
            <label className="flex flex-col text-xs text-ink-400">
              Catégorie
              <select
                className="input"
                aria-label="Catégorie"
                value={catId}
                onChange={(e) => setCatId(e.target.value)}
              >
                <option value="">Choisir…</option>
                {[...addable]
                  .sort((a, b) => {
                    const pa = a.parentId != null ? byId.get(a.parentId)?.name ?? '' : a.name;
                    const pb = b.parentId != null ? byId.get(b.parentId)?.name ?? '' : b.name;
                    return pa.localeCompare(pb) || a.name.localeCompare(b.name);
                  })
                  .map((c) => (
                    <option key={c.id} value={c.id}>{formatCategoryPath(c, byId)}</option>
                  ))}
              </select>
            </label>

            <label className="flex flex-col text-xs text-ink-400">
              Compte
              <select
                className="input"
                aria-label="Compte :"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">Tous les comptes</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>

            <input
              className="input w-32"
              inputMode="decimal"
              aria-label={period === 'monthly' ? 'Plafond mensuel' : 'Plafond annuel'}
              placeholder={placeholder}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
            <button className="btn-primary" onClick={submit} disabled={isPending}>Ajouter</button>
          </div>
        </>
      )}
    </div>
  );
}
