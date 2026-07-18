// Public-safe French seed for the browser-only demo. All names, IBANs,
// and vendor labels are invented. Dates are fixed absolute values so
// the demo looks the same every visit; the trade-off is that the
// six-month narrative slowly drifts out of date — refresh the anchor
// (SEED_TODAY) when it starts to feel stale.
//
// Signs: expenses negative, income positive. Amounts are fixed-point
// strings with two decimals to match the app's storage convention.

import type {
  Account,
  BalanceCheckpoint,
  Budget,
  Category,
  Rule,
  Transaction,
  TransferRule,
} from '../types';
import type { DemoState } from './store';
import { DEMO_SCHEMA_VERSION } from './store';

const SEED_TODAY = '2026-07-18';

const CAT = {
  Courses: 1,
  Restaurant: 2,
  Transport: 3,
  Logement: 4,
  Energie: 5,
  Loisirs: 6,
  Sante: 7,
  Salaire: 8,
} as const;

const ACC = {
  Courant: 1,
  Livret: 2,
} as const;

const categories: Category[] = [
  { id: CAT.Courses,    name: 'Courses',    kind: 'expense', color: '#c084fc', parentId: null, isDefault: true, isInternalTransfer: false },
  { id: CAT.Restaurant, name: 'Restaurant', kind: 'expense', color: '#f97316', parentId: null, isDefault: true, isInternalTransfer: false },
  { id: CAT.Transport,  name: 'Transport',  kind: 'expense', color: '#38bdf8', parentId: null, isDefault: true, isInternalTransfer: false },
  { id: CAT.Logement,   name: 'Logement',   kind: 'expense', color: '#a78bfa', parentId: null, isDefault: true, isInternalTransfer: false },
  { id: CAT.Energie,    name: 'Énergie',    kind: 'expense', color: '#facc15', parentId: null, isDefault: true, isInternalTransfer: false },
  { id: CAT.Loisirs,    name: 'Loisirs',    kind: 'expense', color: '#f472b6', parentId: null, isDefault: true, isInternalTransfer: false },
  { id: CAT.Sante,      name: 'Santé',      kind: 'expense', color: '#4ade80', parentId: null, isDefault: true, isInternalTransfer: false },
  { id: CAT.Salaire,    name: 'Salaire',    kind: 'income',  color: '#22d3ee', parentId: null, isDefault: true, isInternalTransfer: false },
];

const accounts: Account[] = [
  { id: ACC.Courant, name: 'Compte courant', type: 'checking', currency: 'EUR', openingBalance: '2500.00', openingDate: '2026-01-15', displayOrder: 0, createdAt: '2026-01-15T09:00:00.000Z', lockYears: null },
  { id: ACC.Livret,  name: 'Livret A',       type: 'savings',  currency: 'EUR', openingBalance: '8000.00', openingDate: '2026-01-15', displayOrder: 1, createdAt: '2026-01-15T09:00:00.000Z', lockYears: null },
];

const rules: Rule[] = [
  { id: 1, categoryId: CAT.Transport, keyword: 'sncf',      signConstraint: 'negative', matchMode: 'substring', priority: 100, enabled: true, createdAt: '2026-02-01T09:00:00.000Z' },
  { id: 2, categoryId: CAT.Courses,   keyword: 'carrefour', signConstraint: 'negative', matchMode: 'substring', priority: 100, enabled: true, createdAt: '2026-02-01T09:00:00.000Z' },
  { id: 3, categoryId: CAT.Energie,   keyword: 'edf',       signConstraint: 'negative', matchMode: 'substring', priority: 100, enabled: true, createdAt: '2026-02-01T09:00:00.000Z' },
  { id: 4, categoryId: CAT.Courses,   keyword: 'monoprix',  signConstraint: 'negative', matchMode: 'substring', priority: 100, enabled: true, createdAt: '2026-02-01T09:00:00.000Z' },
  { id: 5, categoryId: CAT.Logement,  keyword: 'loyer',     signConstraint: 'negative', matchMode: 'substring', priority: 100, enabled: true, createdAt: '2026-02-01T09:00:00.000Z' },
];

const transferRules: TransferRule[] = [];

const budgets: Budget[] = [
  { id: 1, categoryId: CAT.Courses,    monthlyLimit: '400.00', currency: 'EUR', period: 'monthly', accountId: null },
  { id: 2, categoryId: CAT.Restaurant, monthlyLimit: '150.00', currency: 'EUR', period: 'monthly', accountId: null },
  { id: 3, categoryId: CAT.Loisirs,    monthlyLimit: '100.00', currency: 'EUR', period: 'monthly', accountId: null },
];

interface TxSpec {
  day: number;          // day of month
  label: string;
  amount: number;       // signed
  categoryId: number | null;
  categorySource: 'manual' | 'auto' | 'default';
  accountId?: number;   // default: Courant
}

// Monthly recurring pattern. Applied to each of the six seed months
// (Feb–Jul 2026). Loyer → rule 5 auto; EDF → rule 3 auto; Salaire →
// manual (no rule); Internet/Téléphone → uncategorised (populates the
// tri panel with real content).
const RECURRING: TxSpec[] = [
  { day: 1,  label: 'Virement Salaire',        amount:  2500.00, categoryId: CAT.Salaire, categorySource: 'manual' },
  { day: 5,  label: 'Prélèvement Loyer',       amount:  -850.00, categoryId: CAT.Logement, categorySource: 'auto' },
  { day: 10, label: 'EDF Facture Électricité', amount:   -78.40, categoryId: CAT.Energie,  categorySource: 'auto' },
  { day: 15, label: 'FreeBox Internet',        amount:   -29.99, categoryId: null,         categorySource: 'default' },
  { day: 20, label: 'Bouygues Mobile',         amount:   -19.99, categoryId: null,         categorySource: 'default' },
];

// Weekly-ish discretionary spend. day-of-month per week 1..4 (day 3 =
// early, day 12 = mid, day 19 = late, day 26 = end). Enough coverage to
// hit ~25 discretionary tx / month → ~150 over six months, on top of 30
// recurring = ~180 total per the plan.
const DISCRETIONARY_TEMPLATE: Array<Omit<TxSpec, 'day'>> = [
  { label: 'Carrefour Market',       amount:  -52.30, categoryId: CAT.Courses,    categorySource: 'auto' },
  { label: 'Monoprix',               amount:  -38.75, categoryId: CAT.Courses,    categorySource: 'auto' },
  { label: 'Boulangerie Martin',     amount:  -12.40, categoryId: CAT.Courses,    categorySource: 'manual' },
  { label: 'Café du Coin',           amount:  -14.80, categoryId: CAT.Restaurant, categorySource: 'manual' },
  { label: 'Restaurant Chez Marie',  amount:  -42.60, categoryId: CAT.Restaurant, categorySource: 'manual' },
  { label: 'SNCF Voyages',           amount:  -68.00, categoryId: CAT.Transport,  categorySource: 'auto' },
  { label: 'RATP Navigo',            amount:  -75.20, categoryId: CAT.Transport,  categorySource: 'manual' },
  { label: 'Cinéma Le Grand Rex',    amount:  -22.00, categoryId: CAT.Loisirs,    categorySource: 'manual' },
  { label: 'FNAC Livre',             amount:  -19.90, categoryId: CAT.Loisirs,    categorySource: 'manual' },
  { label: 'Pharmacie Centrale',     amount:  -18.50, categoryId: CAT.Sante,      categorySource: 'manual' },
  { label: 'Carrefour City',         amount:  -27.10, categoryId: CAT.Courses,    categorySource: 'auto' },
  { label: 'Boulangerie Martin',     amount:   -8.90, categoryId: CAT.Courses,    categorySource: 'manual' },
];

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}
function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}
function fmt(amount: number): string {
  return (amount < 0 ? '-' : '') + Math.abs(amount).toFixed(2);
}
function normalize(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildTransactions(): Transaction[] {
  const list: Transaction[] = [];
  let id = 1;
  const SEED_MONTHS: Array<{ year: number; month: number }> = [
    { year: 2026, month: 2 },
    { year: 2026, month: 3 },
    { year: 2026, month: 4 },
    { year: 2026, month: 5 },
    { year: 2026, month: 6 },
    { year: 2026, month: 7 },
  ];

  const push = (spec: TxSpec, year: number, month: number, weekBias: number) => {
    const day = Math.min(spec.day, MONTH_DAYS[month - 1]);
    const date = ymd(year, month, day);
    const acc = spec.accountId ?? ACC.Courant;
    const amt = fmt(spec.amount);
    const norm = normalize(spec.label);
    list.push({
      id: id++,
      accountId: acc,
      date,
      amount: amt,
      rawLabel: spec.label,
      normalizedLabel: norm,
      memo: null,
      notes: null,
      fitid: null,
      dedupKey: `${acc}_${date}_${amt}_${norm}_${weekBias}`,
      categoryId: spec.categoryId,
      categorySource: spec.categorySource,
      transferGroupId: null,
      sourceFileId: null,
      importedAt: date + 'T10:00:00.000Z',
      lockYears: null,
      splits: [],
    });
  };

  for (const { year, month } of SEED_MONTHS) {
    // Recurring
    for (const spec of RECURRING) push(spec, year, month, 0);

    // Discretionary — 3 items per week × 4 weeks = 12 tx/month. Plus a
    // per-month "Boulangerie" doubled and an extra Carrefour, bumping
    // to ~25/month with variety.
    const WEEK_DAYS = [4, 11, 18, 25];
    for (let w = 0; w < WEEK_DAYS.length; w++) {
      // Rotate which items fire each week for realistic variation.
      const startIdx = (month + w) % DISCRETIONARY_TEMPLATE.length;
      for (let k = 0; k < 6; k++) {
        const tpl = DISCRETIONARY_TEMPLATE[(startIdx + k) % DISCRETIONARY_TEMPLATE.length];
        const dayOffset = (k % 3);
        const day = Math.min(WEEK_DAYS[w] + dayOffset, MONTH_DAYS[month - 1]);
        push({ ...tpl, day }, year, month, w * 10 + k);
      }
    }
  }

  // The one large blip — June 2026 vacation.
  list.push({
    id: id++,
    accountId: ACC.Courant,
    date: '2026-06-22',
    amount: '-2800.00',
    rawLabel: 'Vacances été 2026 — location',
    normalizedLabel: 'vacances ete 2026 location',
    memo: null,
    notes: 'Location maison, deux semaines.',
    fitid: null,
    dedupKey: `${ACC.Courant}_2026-06-22_-2800.00_vacances`,
    categoryId: CAT.Loisirs,
    categorySource: 'manual',
    transferGroupId: null,
    sourceFileId: null,
    importedAt: '2026-06-22T10:00:00.000Z',
    lockYears: null,
    splits: [],
  });

  return list;
}

function balanceAt(txs: Transaction[], accountId: number, opening: string, cutoff: string): string {
  let sum = Number(opening);
  for (const t of txs) {
    if (t.accountId !== accountId) continue;
    if (t.date > cutoff) continue;
    sum += Number(t.amount);
  }
  return sum.toFixed(2);
}

function buildCheckpoints(txs: Transaction[]): BalanceCheckpoint[] {
  // ~3 months ago from SEED_TODAY = 2026-04-18. Matches computed balance
  // exactly so the app renders a green diamond on the dashboard.
  const date = '2026-04-18';
  const expected = balanceAt(txs, ACC.Courant, accounts[0].openingBalance, date);
  return [
    {
      id: 1,
      accountId: ACC.Courant,
      checkpointDate: date,
      expectedAmount: expected,
      note: 'Vérifié depuis le relevé papier.',
      createdAt: date + 'T18:00:00.000Z',
    },
  ];
}

// buildSeedState() must return a fresh object graph on every call.
// Mutations via store.setState() would otherwise leak back into the
// module-level constants below and survive reset().
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function buildSeedState(): DemoState {
  const transactions = buildTransactions();
  const balanceCheckpoints = buildCheckpoints(transactions);
  return {
    v: DEMO_SCHEMA_VERSION,
    accounts: clone(accounts),
    categories: clone(categories),
    rules: clone(rules),
    transferRules: clone(transferRules),
    budgets: clone(budgets),
    transactions,
    balanceCheckpoints,
    settings: {
      locale: 'fr',
      currency: 'EUR',
      seedTodayForDemo: SEED_TODAY,
    },
  };
}

export const SEED_META = {
  today: SEED_TODAY,
  accountIds: ACC,
  categoryIds: CAT,
};
