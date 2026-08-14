// LocalStorage-backed store for the browser-only demo.
//
// State is a JSON blob under `athena_demo_state`. Schema is versioned:
// on version mismatch the store wipes and reseeds silently. The seed
// itself is loaded via a hook the caller wires up (Task 2 fills it in);
// until then, uninitialised state stays an empty envelope.
//
// setState() writes synchronously but debounces the localStorage flush
// so bulk mutations don't storm the disk. Subscribers are notified on
// every setState, unbatched.

import type {
  Account, Budget, Category, RecurringSeries, Rule,
  SavingsGoal, SavingsGoalEvent,
} from '../types';
import type { FxRate } from '../../lib/fx';

// Bumped whenever the seed shape changes in a way that must reach every
// visitor on their next tab open. Mismatch triggers a silent reseed.
//   v=1 → v=2  Récurrent seed expanded to 12 series, 3 new categories
//   v=2 → v=3  removed the "Virement Épargne" recurring (a transfer,
//              not a real outflow — it made the forecast eat income)
//   v=3 → v=4  transferRules feature removed; key dropped from state
//   v=4 → v=5  savingsGoals + savingsGoalEvents seeded (migration 0037)
//   v=5 → v=6  fxRates seeded (empty) + settings.displayCurrency (manual
//              FX table, Task 7)
export const DEMO_SCHEMA_VERSION = 6;
const STORAGE_KEY = 'athena_demo_state';
const PERSIST_DEBOUNCE_MS = 250;

export interface DemoState {
  v: number;
  accounts: Account[];
  categories: Category[];
  rules: Rule[];
  budgets: Budget[];
  // Transactions and reports use loose shapes here; individual handlers
  // narrow the type at the call site once the seed lands (Task 2).
  transactions: unknown[];
  balanceCheckpoints: unknown[];
  // Detected recurring series (Récurrent feature). Optional so
  // localStorage snapshots written before this key existed still hydrate;
  // handlers default missing/undefined to [].
  recurring?: RecurringSeries[];
  // Savings goals + events (v5). Optional so pre-v5 snapshots that survive
  // (e.g. in-flight tests) still hydrate; handlers default undefined to [].
  savingsGoals?: SavingsGoal[];
  savingsGoalEvents?: SavingsGoalEvent[];
  // Manual FX table rows (v6). Optional so pre-v6 snapshots that survive
  // still hydrate; handlers default missing/undefined to [].
  fxRates?: DemoFxRate[];
  settings: Record<string, unknown>;
  // Remote-backup destination (Sauvegarde distante card). Non-secret parts
  // only — the demo never stores passwords or passphrases. Optional so
  // older localStorage snapshots still hydrate.
  backupDestination?: {
    kind: 'webdav' | 'folder';
    config: Record<string, unknown>;
    enabled: boolean;
    lastRunAt: string | null;
    lastError: string | null;
  };
}

// A stored FX rate row: the domain shape (fromCcy/toCcy) plus an
// auto-increment id so writes/fx-rates.ts can address a row for PATCH/DELETE
// — mirrors the backend's fx_rates table row (userId omitted; demo is
// single-user).
export type DemoFxRate = FxRate & { id: number };

// Wire shape for GET/POST/PATCH /api/fx-rates responses: `from`/`to` instead
// of the domain's `fromCcy`/`toCcy`. Mirrors backend/src/http/routes/
// fx-rates.ts's shape().
export function fxRateToWire(row: DemoFxRate): { id: number; from: string; to: string; effectiveFrom: string; rate: string } {
  return { id: row.id, from: row.fromCcy, to: row.toCcy, effectiveFrom: row.effectiveFrom, rate: row.rate };
}

type Mutator = (draft: DemoState) => void;
type Subscriber = () => void;

let seedProvider: (() => DemoState) | null = null;
let state: DemoState | null = null;
const subscribers = new Set<Subscriber>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;

export function registerSeedProvider(fn: () => DemoState): void {
  seedProvider = fn;
}

function emptyState(): DemoState {
  return {
    v: DEMO_SCHEMA_VERSION,
    accounts: [],
    categories: [],
    rules: [],
    budgets: [],
    transactions: [],
    balanceCheckpoints: [],
    recurring: [],
    savingsGoals: [],
    savingsGoalEvents: [],
    fxRates: [],
    settings: {},
  };
}

function freshSeed(): DemoState {
  const s = seedProvider ? seedProvider() : emptyState();
  s.v = DEMO_SCHEMA_VERSION;
  return s;
}

function hydrate(): DemoState {
  if (typeof localStorage === 'undefined') return freshSeed();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = freshSeed();
    persistNow(seeded);
    return seeded;
  }
  try {
    const parsed = JSON.parse(raw) as DemoState;
    if (parsed.v !== DEMO_SCHEMA_VERSION) {
      const seeded = freshSeed();
      persistNow(seeded);
      return seeded;
    }
    return parsed;
  } catch {
    const seeded = freshSeed();
    persistNow(seeded);
    return seeded;
  }
}

function persistNow(s: DemoState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Quota exceeded / private mode / etc — losing the write is
    // preferable to crashing the app in demo mode.
  }
}

function schedulePersist(): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (state) persistNow(state);
  }, PERSIST_DEBOUNCE_MS);
}

function notify(): void {
  for (const fn of subscribers) fn();
}

export function getState(): DemoState {
  if (state === null) state = hydrate();
  return state;
}

export function setState(mutator: Mutator): void {
  const current = getState();
  mutator(current);
  schedulePersist();
  notify();
}

export function reset(): void {
  state = freshSeed();
  persistNow(state);
  notify();
}

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

// Test-only escape hatch: fully clears in-memory state and localStorage.
// Not exported through the adapter's public entry; imported directly by
// __tests__ once they exist.
export function __resetForTest(): void {
  state = null;
  seedProvider = null;
  subscribers.clear();
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
}
