// Public-safe French seed for the browser-only demo. All names, IBANs,
// and vendor labels are invented. Dates are fixed absolute values so
// the demo looks the same every visit; the trade-off is that the
// six-month narrative slowly drifts out of date — refresh the anchor
// (SEED_TODAY) when it starts to feel stale.
//
// Signs: expenses negative, income positive. Amounts are fixed-point
// strings with two decimals to match the app's storage convention.

import type {
  Budget,
  Category,
  Rule,
  SavingsGoal,
  SavingsGoalEvent,
} from '../types';
import type { DemoState } from './store';
import { DEMO_SCHEMA_VERSION } from './store';
import { clone } from './seed-utils';
import {
  CAT,
  ACC,
  SEED_TODAY,
  accounts,
  buildTransactions,
  buildCheckpoints,
  buildRecurringSeries,
} from './seed-transactions';

const categories: Category[] = [
  { id: CAT.Courses,     name: 'Courses',     kind: 'expense', color: '#c084fc', parentId: null, isDefault: true, isInternalTransfer: false },
  { id: CAT.Restaurant,  name: 'Restaurant',  kind: 'expense', color: '#f97316', parentId: null, isDefault: true, isInternalTransfer: false },
  { id: CAT.Transport,   name: 'Transport',   kind: 'expense', color: '#38bdf8', parentId: null, isDefault: true, isInternalTransfer: false },
  { id: CAT.Logement,    name: 'Logement',    kind: 'expense', color: '#a78bfa', parentId: null, isDefault: true, isInternalTransfer: false },
  { id: CAT.Energie,     name: 'Énergie',     kind: 'expense', color: '#facc15', parentId: null, isDefault: true, isInternalTransfer: false },
  { id: CAT.Loisirs,     name: 'Loisirs',     kind: 'expense', color: '#f472b6', parentId: null, isDefault: true, isInternalTransfer: false },
  { id: CAT.Sante,       name: 'Santé',       kind: 'expense', color: '#4ade80', parentId: null, isDefault: true, isInternalTransfer: false },
  { id: CAT.Salaire,     name: 'Salaire',     kind: 'income',  color: '#22d3ee', parentId: null, isDefault: true, isInternalTransfer: false },
  { id: CAT.Impots,      name: 'Impôts',      kind: 'expense', color: '#94a3b8', parentId: null, isDefault: true, isInternalTransfer: false },
  { id: CAT.Assurance,   name: 'Assurance',   kind: 'expense', color: '#60a5fa', parentId: null, isDefault: true, isInternalTransfer: false },
  { id: CAT.Abonnements, name: 'Abonnements', kind: 'expense', color: '#f87171', parentId: null, isDefault: true, isInternalTransfer: false },
];

const rules: Rule[] = [
  { id: 1, categoryId: CAT.Transport,   keyword: 'sncf',      signConstraint: 'negative', matchMode: 'substring', priority: 100, enabled: true, createdAt: '2026-02-01T09:00:00.000Z' },
  { id: 2, categoryId: CAT.Courses,     keyword: 'carrefour', signConstraint: 'negative', matchMode: 'substring', priority: 100, enabled: true, createdAt: '2026-02-01T09:00:00.000Z' },
  { id: 3, categoryId: CAT.Energie,     keyword: 'edf',       signConstraint: 'negative', matchMode: 'substring', priority: 100, enabled: true, createdAt: '2026-02-01T09:00:00.000Z' },
  { id: 4, categoryId: CAT.Courses,     keyword: 'monoprix',  signConstraint: 'negative', matchMode: 'substring', priority: 100, enabled: true, createdAt: '2026-02-01T09:00:00.000Z' },
  { id: 5, categoryId: CAT.Logement,    keyword: 'loyer',     signConstraint: 'negative', matchMode: 'substring', priority: 100, enabled: true, createdAt: '2026-02-01T09:00:00.000Z' },
  { id: 6, categoryId: CAT.Impots,      keyword: 'impots',    signConstraint: 'negative', matchMode: 'substring', priority: 100, enabled: true, createdAt: '2026-02-01T09:00:00.000Z' },
  { id: 7, categoryId: CAT.Assurance,   keyword: 'maif',      signConstraint: 'negative', matchMode: 'substring', priority: 100, enabled: true, createdAt: '2026-02-01T09:00:00.000Z' },
  { id: 8, categoryId: CAT.Abonnements, keyword: 'netflix',   signConstraint: 'negative', matchMode: 'substring', priority: 100, enabled: true, createdAt: '2026-02-01T09:00:00.000Z' },
  { id: 9, categoryId: CAT.Abonnements, keyword: 'spotify',   signConstraint: 'negative', matchMode: 'substring', priority: 100, enabled: true, createdAt: '2026-02-01T09:00:00.000Z' },
];

const budgets: Budget[] = [
  { id: 1, categoryId: CAT.Courses,     monthlyLimit: '400.00', currency: 'EUR', period: 'monthly', accountId: null },
  { id: 2, categoryId: CAT.Restaurant,  monthlyLimit: '150.00', currency: 'EUR', period: 'monthly', accountId: null },
  { id: 3, categoryId: CAT.Loisirs,     monthlyLimit: '100.00', currency: 'EUR', period: 'monthly', accountId: null },
  { id: 4, categoryId: CAT.Abonnements, monthlyLimit:  '60.00', currency: 'EUR', period: 'monthly', accountId: null },
];

// buildSeedState() must return a fresh object graph on every call.
export function buildSeedState(): DemoState {
  const transactions = buildTransactions();
  const balanceCheckpoints = buildCheckpoints(transactions);
  const recurring = buildRecurringSeries(transactions);
  const { savingsGoals, savingsGoalEvents } = buildSavingsGoals();
  return {
    v: DEMO_SCHEMA_VERSION,
    accounts: clone(accounts),
    categories: clone(categories),
    rules: clone(rules),
    budgets: clone(budgets),
    transactions,
    balanceCheckpoints,
    recurring,
    savingsGoals,
    savingsGoalEvents,
    fxRates: [],
    settings: {
      locale: 'fr',
      currency: 'EUR',
      seedTodayForDemo: SEED_TODAY,
      // Manual FX table (Task 7): null = per-currency mode, no conversion.
      displayCurrency: null,
    },
  };
}

// Three savings goals from the spec's demo section:
//  1. Livret A / Vacances 2027 — ~40 % filled via monthly events
//  2. Livret A / Fond d'urgence — ~50 % filled, no deadline
//  3. Compte courant / Prochain iPhone — deadline in the past, only 300 € saved
function buildSavingsGoals(): { savingsGoals: SavingsGoal[]; savingsGoalEvents: SavingsGoalEvent[] } {
  const goals: SavingsGoal[] = [
    {
      id: 1, accountId: ACC.Livret, name: 'Vacances 2027',
      targetAmount: '2000.00', targetDate: '2027-07-15',
      color: '#f472b6', closedAt: null, currency: 'EUR',
      savedAmount: '780.00', eventCount: 6,
      rawPct: 39, progressPct: 39, perMonthNeeded: null, overdueDays: null,
    },
    {
      id: 2, accountId: ACC.Livret, name: "Fond d'urgence",
      targetAmount: '5000.00', targetDate: null,
      color: '#22d3ee', closedAt: null, currency: 'EUR',
      savedAmount: '2500.00', eventCount: 3,
      rawPct: 50, progressPct: 50, perMonthNeeded: null, overdueDays: null,
    },
    {
      id: 3, accountId: ACC.Courant, name: 'Prochain iPhone',
      targetAmount: '1200.00', targetDate: '2026-06-08',
      color: '#facc15', closedAt: null, currency: 'EUR',
      savedAmount: '300.00', eventCount: 2,
      rawPct: 25, progressPct: 25, perMonthNeeded: null, overdueDays: 40,
    },
  ];
  const events: SavingsGoalEvent[] = [
    // Goal 1 — six monthly contributions of 130 €
    { id: 1, goalId: 1, amount: '130.00', eventDate: '2026-02-01', note: null, createdAt: '2026-02-01T09:00:00.000Z' },
    { id: 2, goalId: 1, amount: '130.00', eventDate: '2026-03-01', note: null, createdAt: '2026-03-01T09:00:00.000Z' },
    { id: 3, goalId: 1, amount: '130.00', eventDate: '2026-04-01', note: null, createdAt: '2026-04-01T09:00:00.000Z' },
    { id: 4, goalId: 1, amount: '130.00', eventDate: '2026-05-01', note: null, createdAt: '2026-05-01T09:00:00.000Z' },
    { id: 5, goalId: 1, amount: '130.00', eventDate: '2026-06-01', note: null, createdAt: '2026-06-01T09:00:00.000Z' },
    { id: 6, goalId: 1, amount: '130.00', eventDate: '2026-07-01', note: null, createdAt: '2026-07-01T09:00:00.000Z' },
    // Goal 2 — three larger contributions
    { id: 7, goalId: 2, amount: '1000.00', eventDate: '2026-03-15', note: 'Bonus', createdAt: '2026-03-15T09:00:00.000Z' },
    { id: 8, goalId: 2, amount: '800.00',  eventDate: '2026-05-05', note: null, createdAt: '2026-05-05T09:00:00.000Z' },
    { id: 9, goalId: 2, amount: '700.00',  eventDate: '2026-07-01', note: null, createdAt: '2026-07-01T09:00:00.000Z' },
    // Goal 3 — two small ones, late and short of target
    { id: 10, goalId: 3, amount: '150.00', eventDate: '2026-03-10', note: null, createdAt: '2026-03-10T09:00:00.000Z' },
    { id: 11, goalId: 3, amount: '150.00', eventDate: '2026-05-20', note: null, createdAt: '2026-05-20T09:00:00.000Z' },
  ];
  return { savingsGoals: goals, savingsGoalEvents: events };
}

export const SEED_META = {
  today: SEED_TODAY,
  accountIds: ACC,
  categoryIds: CAT,
};
