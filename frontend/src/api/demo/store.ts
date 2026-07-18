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

import type { Account, Budget, Category, Rule, TransferRule } from '../types';

export const DEMO_SCHEMA_VERSION = 1;
const STORAGE_KEY = 'athena_demo_state';
const PERSIST_DEBOUNCE_MS = 250;

export interface DemoState {
  v: number;
  accounts: Account[];
  categories: Category[];
  rules: Rule[];
  transferRules: TransferRule[];
  budgets: Budget[];
  // Transactions and reports use loose shapes here; individual handlers
  // narrow the type at the call site once the seed lands (Task 2).
  transactions: unknown[];
  balanceCheckpoints: unknown[];
  settings: Record<string, unknown>;
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
    transferRules: [],
    budgets: [],
    transactions: [],
    balanceCheckpoints: [],
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
