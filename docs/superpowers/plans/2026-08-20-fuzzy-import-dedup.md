# Fuzzy Import Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Athena's import + duplicates surface with a shared fuzzy-match engine (hard date/amount windows plus Jaccard label gate) so bank re-posts and rounding drift are caught, and the soft-dedup panel stops surfacing coincidental (date, amount) collisions with disjoint labels.

**Architecture:** New shared engine at `backend/src/domain/dedup/fuzzy-match.ts` (SQL narrows candidates, JS scores with the existing pinned-parity `jaccardTokenSimilarity`). Two consumers: import preview (adds a third `fuzzy-duplicate` row status with a pre-ticked skip checkbox and a `skipParsedIndices` commit contract) and the soft-dedup panel (widens the tuple match and post-filters by max-pairwise Jaccard). One narrow DDL change: `file_imports.user_skipped`.

**Tech Stack:** Node 20 + TypeScript (backend), Fastify, Drizzle ORM, PGlite/Postgres, Vitest. React 18 + TypeScript (frontend), Vitest + React Testing Library, i18next, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-20-fuzzy-import-dedup-design.md`

## Global Constraints

- **Match thresholds (verbatim):** `MAX_DAY_DELTA = 3`, `MAX_AMOUNT_DELTA = 0.02`, `LABEL_JACCARD_THRESHOLD = 0.5`. Exported as `const` from `backend/src/domain/dedup/fuzzy-match.ts`. No feature flag, no runtime knob.
- **No new indexes, no pg_trgm, no tokenizer changes.** The engine imports `jaccardTokenSimilarity` from `backend/src/lib/label-similarity.ts` verbatim — the pinned parity test with `frontend/src/lib/label-similarity.ts` must keep passing.
- **`transfer_group_id IS NOT NULL` rows are excluded from fuzzy matching on both sides** (candidate SQL predicate + soft-panel SQL predicate).
- **Opposite-sign pairs never match.** `sameSign(a.amount, b.amount)` is enforced by the predicate.
- **Empty-label rows never fuzzy-match.** `jaccardTokenSimilarity("", "") = 1` by construction; the engine short-circuits with `hasLabelSignal(row) === false → return false`.
- **Attribution:** every git commit MUST run under `git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit ...`. Never modify `.git/config`. Never write the real user name into files.
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.
- **Working branch:** commit directly to `main`. Do not push unless the user asks.
- **French decimal inputs guard:** the fuzzy `matches` list surfaces string amounts as-is (`-25.30`); no new numeric inputs are added in this plan, so the `<input type="number">` prohibition is not triggered.
- **Frontend `max-lines` gate:** frontend files above 300 lines fail CI. `ImportPreviewModal.tsx` is 128 lines today and grows in Task 8 — check the count before commit.
- **Verify before pushing:** run `cd backend && npx vitest run` and `cd frontend && npx vitest run` before pushing (`RUN_DB_TESTS` gated tests skip cleanly on a laptop).

---

## File structure

**Create:**

- `backend/src/db/migrations/0039_file_imports_user_skipped.sql` — one `ALTER TABLE ADD COLUMN`.
- `backend/src/domain/dedup/fuzzy-match.ts` — the shared engine.
- `backend/src/domain/dedup/__tests__/fuzzy-match.test.ts` — unit, no DB.
- `backend/src/domain/dedup/__tests__/fuzzy-match.integration.test.ts` — gated by `RUN_DB_TESTS=1`.
- `backend/src/http/routes/transactions/__tests__/duplicates.test.ts` — unit for the soft panel, gated by `RUN_DB_TESTS=1`.
- `frontend/src/pages/Imports/__tests__/ImportPreviewModal.fuzzy.test.tsx` — third-status + checkbox coverage (a separate file keeps the existing `ImportPreviewModal.test.tsx` untouched and small).
- `frontend/e2e-fullstack/imports-fuzzy-dedup.spec.ts` — Playwright end-to-end.

**Modify:**

- `backend/src/db/schema.ts` — add `userSkipped` to `fileImports`.
- `backend/src/domain/imports/preview-service.ts` — call `findFuzzyMatches`, emit `fuzzyDuplicateRows`.
- `backend/src/domain/imports/import-service.ts` — accept `skipParsedIndices`, count `userSkipped`, store on `file_imports`.
- `backend/src/http/routes/imports.ts` — parse `skipParsedIndices` from the multipart body of `POST /api/imports`.
- `backend/src/http/routes/transactions/duplicates.ts` — widen SQL, filter groups in JS by Jaccard, keep response shape.
- `backend/src/http/routes/backup/schema.ts` — add `userSkipped: z.number().int().default(0)` to the `fileImports` block.
- `backend/src/http/routes/backup/restore-transactions.ts` — pass `userSkipped` through.
- `backend/src/domain/imports/__tests__/preview-service.test.ts` — extend with three fuzzy-scenario cases.
- `frontend/src/api/imports.ts` — add `fuzzyDuplicateRows` to `ImportPreview`; change `confirm` signature indirectly via a new `commitImport` call shape.
- `frontend/src/api/client.ts` — extend `apiUpload<T>` to accept an optional `fields?: Record<string, string>` map alongside `query`.
- `frontend/src/pages/Imports/ImportPreviewModal.tsx` — third `Tagged.status`, checkbox column for fuzzy rows, expand-on-click match line, third counter.
- `frontend/src/pages/Imports/useImportPreview.ts` — collect the ticked fuzzy indices, send them at commit.
- `frontend/src/locales/fr/imports.json` and `frontend/src/locales/en/imports.json` — three new keys.

---

## Task 1: Migration + schema for `file_imports.user_skipped`

**Files:**
- Create: `backend/src/db/migrations/0039_file_imports_user_skipped.sql`
- Modify: `backend/src/db/schema.ts` (add `userSkipped` to `fileImports` block near line 305)
- Modify: `backend/src/http/routes/backup/schema.ts` (add `userSkipped` to the `fileImports` block near line 100)
- Modify: `backend/src/http/routes/backup/restore-transactions.ts` (pass `userSkipped` through, near line 38)

**Interfaces:**
- Consumes: nothing.
- Produces: DB column `file_imports.user_skipped integer NOT NULL DEFAULT 0`; Drizzle field `fileImports.userSkipped: number`; Zod `userSkipped: z.number().int()`. Every later task that reads or writes `file_imports` assumes this column exists.

- [ ] **Step 1: Write the migration SQL**

Create `backend/src/db/migrations/0039_file_imports_user_skipped.sql`:

```sql
ALTER TABLE file_imports
  ADD COLUMN user_skipped INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Add the Drizzle column**

In `backend/src/db/schema.ts`, inside the `fileImports = pgTable('file_imports', { ... })` block, add the field right after `dedupSkipped`:

```ts
  dedupSkipped: integer('dedup_skipped').notNull(),
  userSkipped: integer('user_skipped').notNull().default(0),
```

- [ ] **Step 3: Extend the backup Zod schema**

In `backend/src/http/routes/backup/schema.ts`, inside the `fileImports` Zod object (currently ~line 100), add:

```ts
  dedupSkipped: z.number().int(),
  userSkipped: z.number().int().default(0),   // NEW — .default() for old-backup compat
```

- [ ] **Step 4: Pass `userSkipped` through the restore path**

In `backend/src/http/routes/backup/restore-transactions.ts`, wherever the block that maps a parsed `fileImports` row to the insert values lives (near line 38), add `userSkipped: f.userSkipped` next to the existing `dedupSkipped: f.dedupSkipped`.

- [ ] **Step 5: Type-check the backend**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run backend unit tests to prove nothing regressed**

Run: `cd backend && npx vitest run`
Expected: all previously green tests still pass (DB-gated ones skip cleanly).

- [ ] **Step 7: Commit**

```bash
git add backend/src/db/migrations/0039_file_imports_user_skipped.sql \
        backend/src/db/schema.ts \
        backend/src/http/routes/backup/schema.ts \
        backend/src/http/routes/backup/restore-transactions.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "$(cat <<'EOF'
feat(schema): add file_imports.user_skipped for fuzzy-dedup preview skips

Migration 0039 + Drizzle field + backup schema. Defaults to 0 so old
imports and old backups restore without change.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Fuzzy-match engine (pure predicate + constants)

**Files:**
- Create: `backend/src/domain/dedup/fuzzy-match.ts`
- Create: `backend/src/domain/dedup/__tests__/fuzzy-match.test.ts`

**Interfaces:**
- Consumes: `jaccardTokenSimilarity` and `tokenize` from `backend/src/lib/label-similarity.ts`.
- Produces:
  - Constants `MAX_DAY_DELTA = 3`, `MAX_AMOUNT_DELTA = 0.02`, `LABEL_JACCARD_THRESHOLD = 0.5`.
  - `interface FuzzyCandidate { txId?: number; date: string; amount: string; normalizedLabel: string; rawLabel: string; }`
  - `interface ScoredMatch { candidate: FuzzyCandidate; jaccard: number; }`
  - `function hasLabelSignal(row: { rawLabel: string }): boolean`
  - `function passesHardWindows(a: FuzzyCandidate, b: FuzzyCandidate): boolean`
  - `function fuzzyMatchesPair(a: FuzzyCandidate, b: FuzzyCandidate): boolean`

- [ ] **Step 1: Write the failing test file**

Create `backend/src/domain/dedup/__tests__/fuzzy-match.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  MAX_DAY_DELTA,
  MAX_AMOUNT_DELTA,
  LABEL_JACCARD_THRESHOLD,
  hasLabelSignal,
  passesHardWindows,
  fuzzyMatchesPair,
  type FuzzyCandidate,
} from '../fuzzy-match.js';

function row(overrides: Partial<FuzzyCandidate> = {}): FuzzyCandidate {
  return {
    date: '2026-06-15',
    amount: '-25.30',
    normalizedLabel: 'carrefour market',
    rawLabel: 'CB CARREFOUR MARKET 15/06',
    ...overrides,
  };
}

describe('fuzzy-match constants', () => {
  it('locks the thresholds documented in the spec', () => {
    expect(MAX_DAY_DELTA).toBe(3);
    expect(MAX_AMOUNT_DELTA).toBe(0.02);
    expect(LABEL_JACCARD_THRESHOLD).toBe(0.5);
  });
});

describe('hasLabelSignal', () => {
  it('rejects empty raw labels', () => {
    expect(hasLabelSignal({ rawLabel: '' })).toBe(false);
  });
  it('rejects labels whose tokens are all stopwords + digits', () => {
    expect(hasLabelSignal({ rawLabel: 'CB 12345' })).toBe(false);
  });
  it('accepts labels with at least one merchant-y token', () => {
    expect(hasLabelSignal({ rawLabel: 'CB CARREFOUR 12345' })).toBe(true);
  });
});

describe('passesHardWindows', () => {
  it('accepts an exact tuple', () => {
    expect(passesHardWindows(row(), row())).toBe(true);
  });
  it.each([1, 2, 3])('accepts Δdate = %s days', (delta) => {
    const b = row({ date: shiftDate('2026-06-15', delta) });
    expect(passesHardWindows(row(), b)).toBe(true);
  });
  it('rejects Δdate = 4 days', () => {
    const b = row({ date: shiftDate('2026-06-15', 4) });
    expect(passesHardWindows(row(), b)).toBe(false);
  });
  it.each(['-25.30', '-25.31', '-25.32'])('accepts amount within window: %s', (amount) => {
    expect(passesHardWindows(row(), row({ amount }))).toBe(true);
  });
  it('rejects amount out of window (Δ = 0.03)', () => {
    expect(passesHardWindows(row(), row({ amount: '-25.33' }))).toBe(false);
  });
  it('rejects opposite sign', () => {
    expect(passesHardWindows(row(), row({ amount: '25.30' }))).toBe(false);
  });
});

describe('fuzzyMatchesPair', () => {
  it('accepts a same-merchant near-duplicate', () => {
    const a = row({ rawLabel: 'CB CARREFOUR MARKET 15/06' });
    const b = row({
      date: '2026-06-17',           // Δ=2
      amount: '-25.31',              // Δ=0.01
      rawLabel: 'PAIEMENT CARREFOUR MARKET REF-98',
    });
    expect(fuzzyMatchesPair(a, b)).toBe(true);
  });
  it('rejects when labels are token-disjoint (Jaccard = 0)', () => {
    const a = row({ rawLabel: 'CB CARREFOUR MARKET' });
    const b = row({ rawLabel: 'SNCF PARIS LYON' });
    expect(fuzzyMatchesPair(a, b)).toBe(false);
  });
  it('rejects when either normalized label has no token signal', () => {
    const a = row({ rawLabel: '' });
    expect(fuzzyMatchesPair(a, row())).toBe(false);
  });
  it('rejects opposite sign even with identical label', () => {
    expect(fuzzyMatchesPair(row(), row({ amount: '25.30' }))).toBe(false);
  });
});

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/domain/dedup/__tests__/fuzzy-match.test.ts`
Expected: FAIL — `Cannot find module '../fuzzy-match.js'`.

- [ ] **Step 3: Write the engine**

Create `backend/src/domain/dedup/fuzzy-match.ts`:

```ts
import { jaccardTokenSimilarity, tokenize } from '../../lib/label-similarity.js';

// Locked in the design (see docs/superpowers/specs/2026-08-20-fuzzy-import-dedup-design.md, D1).
export const MAX_DAY_DELTA = 3;
export const MAX_AMOUNT_DELTA = 0.02;
export const LABEL_JACCARD_THRESHOLD = 0.5;

export interface FuzzyCandidate {
  txId?: number;
  date: string;
  amount: string;
  normalizedLabel: string;
  rawLabel: string;
}

export interface ScoredMatch {
  candidate: FuzzyCandidate;
  jaccard: number;
}

// jaccardTokenSimilarity('', '') === 1 by design (it powers recurring-series
// clustering, where "no label" is a legitimate cluster key). For dedup we want
// the opposite: two rows with no extractable label content give us zero
// signal, so they must not fuzzy-match on date+amount alone.
export function hasLabelSignal(row: { rawLabel: string }): boolean {
  return tokenize(row.rawLabel).size > 0;
}

function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  const ta = Date.UTC(ay, am - 1, ad);
  const tb = Date.UTC(by, bm - 1, bd);
  return Math.abs(ta - tb) / 86_400_000;
}

function sameSign(a: string, b: string): boolean {
  const sa = a.startsWith('-');
  const sb = b.startsWith('-');
  return sa === sb;
}

export function passesHardWindows(a: FuzzyCandidate, b: FuzzyCandidate): boolean {
  if (!sameSign(a.amount, b.amount)) return false;
  if (diffDays(a.date, b.date) > MAX_DAY_DELTA) return false;
  const na = Number(a.amount);
  const nb = Number(b.amount);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  if (Math.abs(na - nb) > MAX_AMOUNT_DELTA + 1e-9) return false;
  return true;
}

export function fuzzyMatchesPair(a: FuzzyCandidate, b: FuzzyCandidate): boolean {
  if (!passesHardWindows(a, b)) return false;
  if (!hasLabelSignal(a) || !hasLabelSignal(b)) return false;
  return jaccardTokenSimilarity(a.rawLabel, b.rawLabel) >= LABEL_JACCARD_THRESHOLD;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/domain/dedup/__tests__/fuzzy-match.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Run the full backend suite to guard the parity test**

Run: `cd backend && npx vitest run`
Expected: PASS, including `label-similarity-parity.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/domain/dedup/fuzzy-match.ts \
        backend/src/domain/dedup/__tests__/fuzzy-match.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "$(cat <<'EOF'
feat(dedup): pure fuzzy-match predicate + constants

Hard windows (Δdate ≤ 3, Δamount ≤ 0.02, sign match) plus Jaccard label
gate ≥ 0.5. Empty-label rows reject to avoid the "no signal" case that
jaccardTokenSimilarity('', '') would otherwise accept.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Batch `findFuzzyMatches` (SQL narrow + JS score)

**Files:**
- Modify: `backend/src/domain/dedup/fuzzy-match.ts` (append `findFuzzyMatches`)
- Create: `backend/src/domain/dedup/__tests__/fuzzy-match.integration.test.ts` (RUN_DB_TESTS=1)

**Interfaces:**
- Consumes: `passesHardWindows`, `hasLabelSignal`, `LABEL_JACCARD_THRESHOLD` from Task 2; `db`, `transactions` from Drizzle.
- Produces: `async function findFuzzyMatches(opts: { accountId: number; userId: number; incoming: FuzzyCandidate[] }): Promise<Map<number, ScoredMatch[]>>` — sorted by Jaccard descending, missing key = no match.

- [ ] **Step 1: Write the integration test file (skip-gated)**

Create `backend/src/domain/dedup/__tests__/fuzzy-match.integration.test.ts`:

```ts
// requires Postgres — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

const RUN = !!process.env.RUN_DB_TESTS;

let userId: number;
let accountA: number;
let accountB: number;

describe.skipIf(!RUN)('findFuzzyMatches', () => {
  beforeAll(async () => {
    const { db } = await import('../../../db/client.js');
    const { users, accounts } = await import('../../../db/schema.js');
    const [u] = await db.insert(users).values({
      username: 'fuzzy-match-user', passwordHash: 'x',
    }).returning();
    userId = u!.id;
    const [a] = await db.insert(accounts).values({
      userId, name: 'Fuzzy A', type: 'checking', openingDate: '2025-01-01',
    }).returning();
    accountA = a!.id;
    const [b] = await db.insert(accounts).values({
      userId, name: 'Fuzzy B', type: 'checking', openingDate: '2025-01-01',
    }).returning();
    accountB = b!.id;
  });

  afterEach(async () => {
    const { db } = await import('../../../db/client.js');
    const { transactions } = await import('../../../db/schema.js');
    await db.delete(transactions);
  });

  it('surfaces same-account fuzzy matches inside the date/amount window', async () => {
    const { db } = await import('../../../db/client.js');
    const { transactions } = await import('../../../db/schema.js');
    await db.insert(transactions).values({
      userId, accountId: accountA,
      date: '2026-06-15', amount: '-25.30',
      rawLabel: 'CB CARREFOUR MARKET',
      normalizedLabel: 'carrefour market',
      dedupKey: 'hash:seed-1', memo: null, fitid: null,
    });
    const { findFuzzyMatches } = await import('../fuzzy-match.js');
    const result = await findFuzzyMatches({
      accountId: accountA, userId,
      incoming: [
        {
          date: '2026-06-17', amount: '-25.31',
          rawLabel: 'PAIEMENT CARREFOUR MARKET REF-98',
          normalizedLabel: 'carrefour market',
        },
      ],
    });
    expect(result.size).toBe(1);
    const matches = result.get(0)!;
    expect(matches.length).toBe(1);
    expect(matches[0]!.jaccard).toBeGreaterThanOrEqual(0.5);
    expect(matches[0]!.candidate.txId).toBeTruthy();
  });

  it('excludes rows on a different account', async () => {
    const { db } = await import('../../../db/client.js');
    const { transactions } = await import('../../../db/schema.js');
    await db.insert(transactions).values({
      userId, accountId: accountB,
      date: '2026-06-15', amount: '-25.30',
      rawLabel: 'CB CARREFOUR', normalizedLabel: 'carrefour',
      dedupKey: 'hash:seed-2', memo: null, fitid: null,
    });
    const { findFuzzyMatches } = await import('../fuzzy-match.js');
    const result = await findFuzzyMatches({
      accountId: accountA, userId,
      incoming: [{
        date: '2026-06-15', amount: '-25.30',
        rawLabel: 'CB CARREFOUR', normalizedLabel: 'carrefour',
      }],
    });
    expect(result.size).toBe(0);
  });

  it('excludes rows with transfer_group_id set', async () => {
    const { db } = await import('../../../db/client.js');
    const { transactions } = await import('../../../db/schema.js');
    await db.insert(transactions).values({
      userId, accountId: accountA,
      date: '2026-06-15', amount: '-25.30',
      rawLabel: 'CB CARREFOUR', normalizedLabel: 'carrefour',
      dedupKey: 'hash:seed-3', memo: null, fitid: null,
      transferGroupId: 'legacy-group',
    });
    const { findFuzzyMatches } = await import('../fuzzy-match.js');
    const result = await findFuzzyMatches({
      accountId: accountA, userId,
      incoming: [{
        date: '2026-06-15', amount: '-25.30',
        rawLabel: 'CB CARREFOUR', normalizedLabel: 'carrefour',
      }],
    });
    expect(result.size).toBe(0);
  });

  it('sorts multiple candidates by Jaccard descending', async () => {
    const { db } = await import('../../../db/client.js');
    const { transactions } = await import('../../../db/schema.js');
    await db.insert(transactions).values([
      {
        userId, accountId: accountA,
        date: '2026-06-15', amount: '-25.30',
        rawLabel: 'CARREFOUR MARKET PARIS', normalizedLabel: 'carrefour market paris',
        dedupKey: 'hash:multi-1', memo: null, fitid: null,
      },
      {
        userId, accountId: accountA,
        date: '2026-06-16', amount: '-25.30',
        rawLabel: 'CARREFOUR PARIS', normalizedLabel: 'carrefour paris',
        dedupKey: 'hash:multi-2', memo: null, fitid: null,
      },
    ]);
    const { findFuzzyMatches } = await import('../fuzzy-match.js');
    const result = await findFuzzyMatches({
      accountId: accountA, userId,
      incoming: [{
        date: '2026-06-15', amount: '-25.30',
        rawLabel: 'CARREFOUR MARKET PARIS',
        normalizedLabel: 'carrefour market paris',
      }],
    });
    const matches = result.get(0)!;
    expect(matches.length).toBe(2);
    expect(matches[0]!.jaccard).toBeGreaterThanOrEqual(matches[1]!.jaccard);
  });
});
```

- [ ] **Step 2: Append `findFuzzyMatches` to `fuzzy-match.ts`**

Add at the bottom of `backend/src/domain/dedup/fuzzy-match.ts`:

```ts
import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { transactions } from '../../db/schema.js';
import { jaccardTokenSimilarity as jaccard } from '../../lib/label-similarity.js';

export async function findFuzzyMatches(opts: {
  accountId: number;
  userId: number;
  incoming: FuzzyCandidate[];
}): Promise<Map<number, ScoredMatch[]>> {
  const result = new Map<number, ScoredMatch[]>();
  if (opts.incoming.length === 0) return result;

  let minDate = opts.incoming[0]!.date;
  let maxDate = opts.incoming[0]!.date;
  let minAmount = Number(opts.incoming[0]!.amount);
  let maxAmount = minAmount;
  for (const r of opts.incoming) {
    if (r.date < minDate) minDate = r.date;
    if (r.date > maxDate) maxDate = r.date;
    const n = Number(r.amount);
    if (n < minAmount) minAmount = n;
    if (n > maxAmount) maxAmount = n;
  }

  const dateLo = shiftIso(minDate, -MAX_DAY_DELTA);
  const dateHi = shiftIso(maxDate, MAX_DAY_DELTA);
  const amountLo = (minAmount - MAX_AMOUNT_DELTA).toFixed(2);
  const amountHi = (maxAmount + MAX_AMOUNT_DELTA).toFixed(2);

  const candidates = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      rawLabel: transactions.rawLabel,
      normalizedLabel: transactions.normalizedLabel,
    })
    .from(transactions)
    .where(and(
      eq(transactions.userId, opts.userId),
      eq(transactions.accountId, opts.accountId),
      isNull(transactions.transferGroupId),
      gte(transactions.date, dateLo),
      lte(transactions.date, dateHi),
      sql`${transactions.amount}::numeric BETWEEN ${amountLo} AND ${amountHi}`,
    ));

  for (const existing of candidates) {
    const eCand: FuzzyCandidate = {
      txId: existing.id,
      date: existing.date,
      amount: existing.amount,
      rawLabel: existing.rawLabel,
      normalizedLabel: existing.normalizedLabel,
    };
    for (let i = 0; i < opts.incoming.length; i++) {
      const inc = opts.incoming[i]!;
      if (!passesHardWindows(inc, eCand)) continue;
      if (!hasLabelSignal(inc) || !hasLabelSignal(eCand)) continue;
      const score = jaccard(inc.rawLabel, eCand.rawLabel);
      if (score < LABEL_JACCARD_THRESHOLD) continue;
      const list = result.get(i) ?? [];
      list.push({ candidate: eCand, jaccard: score });
      result.set(i, list);
    }
  }

  for (const list of result.values()) list.sort((a, b) => b.jaccard - a.jaccard);
  return result;
}

function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
```

- [ ] **Step 3: Type-check**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the unit suite (integration test skipped without RUN_DB_TESTS)**

Run: `cd backend && npx vitest run`
Expected: PASS. The integration test file skips silently.

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/dedup/fuzzy-match.ts \
        backend/src/domain/dedup/__tests__/fuzzy-match.integration.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "$(cat <<'EOF'
feat(dedup): findFuzzyMatches — SQL narrow + JS score, sorted desc

One range query on (account_id, date, amount) picks candidates from the
existing index, then JS filters by Jaccard ≥ 0.5. Excludes rows with
transfer_group_id set. Returns Map<incomingIndex, ScoredMatch[]> sorted
best-first so callers cheaply take top-N.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Extend `previewImport` with `fuzzyDuplicateRows`

**Files:**
- Modify: `backend/src/domain/imports/preview-service.ts`
- Modify: `backend/src/domain/imports/__tests__/preview-service.test.ts`

**Interfaces:**
- Consumes: `findFuzzyMatches` from Task 3; existing `parseFile`, `computeDedupKey`, `normalizeLabel`.
- Produces: `PreviewResult.fuzzyDuplicateRows: Array<{ row: PreviewRow; parsedIndex: number; matches: Array<{ txId: number; date: string; amount: string; rawLabel: string }> }>`. Preview flow consumers see the same `newRows` and `duplicateRows` semantics as before.

- [ ] **Step 1: Extend the DB-gated test file with fuzzy cases**

Add to `backend/src/domain/imports/__tests__/preview-service.test.ts`:

```ts
  it('flags a near-duplicate (Δdate=1, Δamount=0.01) as fuzzy, not new', async () => {
    const { runImport } = await import('../import-service.js');
    const { previewImport } = await import('../preview-service.js');

    const seed = 'Date;Libellé;Montant\n15/06/2026;CB CARREFOUR MARKET;-25,30\n';
    await runImport({
      filename: 'seed.csv', accountId, userId, format: 'csv',
      buffer: Buffer.from(seed, 'utf-8'),
    });

    const preview =
      'Date;Libellé;Montant\n16/06/2026;PAIEMENT CARREFOUR MARKET REF98;-25,31\n';
    const result = await previewImport({
      filename: 'again.csv', accountId, userId, format: 'csv',
      buffer: Buffer.from(preview, 'utf-8'),
    });

    expect(result.newRows).toHaveLength(0);
    expect(result.duplicateRows).toHaveLength(0);
    expect(result.fuzzyDuplicateRows).toHaveLength(1);
    expect(result.fuzzyDuplicateRows[0]!.parsedIndex).toBe(0);
    expect(result.fuzzyDuplicateRows[0]!.matches).toHaveLength(1);
    expect(result.fuzzyDuplicateRows[0]!.matches[0]!.txId).toBeTruthy();
  });

  it('keeps a token-disjoint row as new even when date+amount align', async () => {
    const { runImport } = await import('../import-service.js');
    const { previewImport } = await import('../preview-service.js');
    const seed = 'Date;Libellé;Montant\n15/06/2026;CB CARREFOUR MARKET;-25,30\n';
    await runImport({
      filename: 'seed.csv', accountId, userId, format: 'csv',
      buffer: Buffer.from(seed, 'utf-8'),
    });
    const preview = 'Date;Libellé;Montant\n15/06/2026;SNCF PARIS LYON;-25,30\n';
    const result = await previewImport({
      filename: 'again.csv', accountId, userId, format: 'csv',
      buffer: Buffer.from(preview, 'utf-8'),
    });
    expect(result.newRows).toHaveLength(1);
    expect(result.fuzzyDuplicateRows).toHaveLength(0);
  });

  it('caps matches per fuzzy row at 3 by Jaccard descending', async () => {
    const { db } = await import('../../../db/client.js');
    const { transactions, fileImports } = await import('../../../db/schema.js');
    const { previewImport } = await import('../preview-service.js');
    const [fi] = await db.insert(fileImports).values({
      userId, filename: 'multi.csv', accountId, format: 'csv',
      totalLines: 4, insertedCount: 4, dedupSkipped: 0, userSkipped: 0,
    }).returning();
    const seedRaw = [
      'CARREFOUR MARKET PARIS RIVOLI',
      'CARREFOUR MARKET PARIS BASTILLE',
      'CARREFOUR PARIS OPERA',
      'CARREFOUR MARKET NICE PROMENADE',
    ];
    for (let i = 0; i < seedRaw.length; i++) {
      await db.insert(transactions).values({
        userId, accountId,
        date: `2026-06-${13 + i}`,      // 13, 14, 15, 16 — all within ±3 of 15
        amount: '-25.30',
        rawLabel: seedRaw[i]!,
        normalizedLabel: seedRaw[i]!.toLowerCase(),
        dedupKey: `hash:multi-${i}`, memo: null, fitid: null,
        sourceFileId: fi!.id,
      });
    }
    const preview =
      'Date;Libellé;Montant\n15/06/2026;CARREFOUR MARKET PARIS RIVOLI;-25,30\n';
    const result = await previewImport({
      filename: 'again.csv', accountId, userId, format: 'csv',
      buffer: Buffer.from(preview, 'utf-8'),
    });
    expect(result.fuzzyDuplicateRows).toHaveLength(1);
    expect(result.fuzzyDuplicateRows[0]!.matches.length).toBeLessThanOrEqual(3);
  });
```

- [ ] **Step 2: Update `previewImport` to compute `fuzzyDuplicateRows`**

Modify `backend/src/domain/imports/preview-service.ts`. Update `PreviewResult`, then extend the flow:

```ts
import { findFuzzyMatches, type FuzzyCandidate } from '../dedup/fuzzy-match.js';

export interface FuzzyDuplicatePreviewRow {
  row: PreviewRow;
  parsedIndex: number;
  matches: Array<{
    txId: number;
    date: string;
    amount: string;
    rawLabel: string;
  }>;
}

export interface PreviewResult {
  filename: string;
  format: PreviewFormat;
  accountId: number;
  totalRows: number;
  newRows: PreviewRow[];
  duplicateRows: PreviewRow[];
  fuzzyDuplicateRows: FuzzyDuplicatePreviewRow[];
}
```

Inside `previewImport`, after the existing hard-dedup split, add:

```ts
  const newParsedIndices: number[] = [];
  const newFuzzyInput: FuzzyCandidate[] = [];
  for (let i = 0; i < withKeys.length; i++) {
    const w = withKeys[i]!;
    if (seen.has(w.dedupKey)) continue;
    newParsedIndices.push(i);
    newFuzzyInput.push({
      date: w.row.date,
      amount: w.row.amount,
      rawLabel: w.row.rawLabel,
      normalizedLabel: normalizeLabel(w.row.rawLabel),
    });
  }

  const fuzzyMap = await findFuzzyMatches({
    accountId: opts.accountId,
    userId: opts.userId,
    incoming: newFuzzyInput,
  });

  const newRows: PreviewRow[] = [];
  const fuzzyDuplicateRows: FuzzyDuplicatePreviewRow[] = [];
  for (let idx = 0; idx < newFuzzyInput.length; idx++) {
    const parsedIndex = newParsedIndices[idx]!;
    const row = withKeys[parsedIndex]!.row;
    const matches = fuzzyMap.get(idx);
    if (!matches || matches.length === 0) {
      newRows.push(row);
      continue;
    }
    fuzzyDuplicateRows.push({
      row,
      parsedIndex,
      matches: matches.slice(0, 3).map((m) => ({
        txId: m.candidate.txId!,
        date: m.candidate.date,
        amount: m.candidate.amount,
        rawLabel: m.candidate.rawLabel,
      })),
    });
  }

  const duplicateRows: PreviewRow[] = [];
  for (const w of withKeys) if (seen.has(w.dedupKey)) duplicateRows.push(w.row);

  return {
    filename: opts.filename,
    format: opts.format,
    accountId: opts.accountId,
    totalRows: parsed.length,
    newRows,
    duplicateRows,
    fuzzyDuplicateRows,
  };
```

Delete the old `for (const w of withKeys) { if (seen.has(w.dedupKey)) duplicateRows.push(w.row); else newRows.push(w.row); }` block. `fuzzyDuplicateRows` MUST always be present (even when empty) to keep the response shape stable.

- [ ] **Step 3: Run the extended DB-gated tests (skip without RUN_DB_TESTS)**

Run: `cd backend && RUN_DB_TESTS=1 npx vitest run src/domain/imports/__tests__/preview-service.test.ts` (only if a Postgres URL is configured; otherwise skip).

Also run without the flag to confirm graceful skip:
Run: `cd backend && npx vitest run src/domain/imports/__tests__/preview-service.test.ts`
Expected: describe skipped.

- [ ] **Step 4: Type-check**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Full backend suite**

Run: `cd backend && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/domain/imports/preview-service.ts \
        backend/src/domain/imports/__tests__/preview-service.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "$(cat <<'EOF'
feat(imports): preview surfaces fuzzyDuplicateRows next to new/duplicate

Runs findFuzzyMatches on the leftover new rows and moves those with ≥ 1
match into fuzzyDuplicateRows carrying parsedIndex + up to 3 candidates
(Jaccard-sorted). Wire shape stable: fuzzyDuplicateRows is always
present, even empty.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `runImport` accepts `skipParsedIndices`; `/api/imports` parses it

**Files:**
- Modify: `backend/src/domain/imports/import-service.ts`
- Modify: `backend/src/http/routes/imports.ts`

**Interfaces:**
- Consumes: `PreviewResult` from Task 4 (parsedIndex semantics).
- Produces: `runImport` gains optional `skipParsedIndices: number[]`. `ImportResult` gains `userSkipped: number` alongside `insertedCount`, `dedupSkipped`. `POST /api/imports` accepts an optional multipart field `skipParsedIndices` (JSON-encoded string of number array).

- [ ] **Step 1: Extend `runImport` types + logic**

In `backend/src/domain/imports/import-service.ts`:

Update `ImportResult`:

```ts
export interface ImportResult {
  fileImportId: number;
  format: ImportFormat;
  accountId: number;
  totalLines: number;
  insertedCount: number;
  dedupSkipped: number;
  userSkipped: number;                        // NEW
  insertedIds: number[];
  dedupSkippedRows: Array<{ date: string; amount: string; rawLabel: string }>;
}
```

Extend the `runImport` signature and body:

```ts
export async function runImport(opts: {
  filename: string;
  accountId: number;
  userId: number;
  format: ImportFormat;
  buffer?: Buffer;
  prepared?: ParsedTransaction[];
  skipParsedIndices?: number[];               // NEW
}): Promise<ImportResult> {
  // ... existing parsing/tx-begin block unchanged ...

  const skipSet = new Set<number>();
  if (opts.skipParsedIndices) {
    for (const n of opts.skipParsedIndices) {
      if (Number.isInteger(n) && n >= 0 && n < parsed.length) skipSet.add(n);
    }
  }
  const userSkipped = skipSet.size;
```

Inside the existing chunk-build loop, drop skipped indices BEFORE composing `rowValues`:

```ts
      const rowValues: Array<...> = [];
      const parsedIndexForRowValue: number[] = [];
      for (let i = 0; i < parsed.length; i++) {
        if (skipSet.has(i)) continue;
        const p = parsed[i]!;
        const normalizedLabel = normalizeLabel(p.rawLabel);
        const dedupKey = computeDedupKey({
          accountId: opts.accountId,
          date: p.date, amount: p.amount, normalizedLabel, fitid: p.fitid,
        });
        rowValues.push({
          userId: opts.userId,
          accountId: opts.accountId,
          date: p.date, amount: p.amount,
          rawLabel: p.rawLabel, normalizedLabel,
          memo: p.memo, fitid: p.fitid,
          dedupKey, sourceFileId: fileImport.id,
        });
        parsedIndexForRowValue.push(i);
      }
```

Reconciliation loop below uses `parsedIndexForRowValue`:

```ts
      for (let j = 0; j < rowValues.length; j++) {
        const i = parsedIndexForRowValue[j]!;
        const p = parsed[i]!;
        const key = rowValues[j]!.dedupKey;
        const id = insertedByKey.get(key);
        if (id !== undefined) {
          inserted++;
          insertedIds.push(id);
          insertedByKey.delete(key);
        } else {
          skipped++;
          dedupSkippedRows.push({ date: p.date, amount: p.amount, rawLabel: p.rawLabel });
        }
      }
```

Update the `file_imports` counts write and the returned object:

```ts
    await tx.update(fileImports)
      .set({ insertedCount: inserted, dedupSkipped: skipped, userSkipped })
      .where(eq(fileImports.id, fileImport.id));

    // ...

    return {
      fileImportId: fileImport.id,
      format: opts.format,
      accountId: opts.accountId,
      totalLines: parsed.length,
      insertedCount: inserted,
      dedupSkipped: skipped,
      userSkipped,                            // NEW
      insertedIds,
      dedupSkippedRows,
    };
  });
```

- [ ] **Step 2: Update the trace line to include user-skipped**

Change the closing `trace(...)` line to:

```ts
  trace(
    `done file=${opts.filename} inserted=${result.insertedCount} ` +
    `deduped=${result.dedupSkipped} user-skipped=${result.userSkipped} ` +
    `parse=${tParsed - tStart}ms tx=${tCommitted - tParsed}ms total=${tCommitted - tStart}ms`,
  );
```

- [ ] **Step 3: Parse `skipParsedIndices` in the multipart handler**

In `backend/src/http/routes/imports.ts`, inside `app.post('/api/imports', ...)`, after the buffer is materialized and before `runImport` is called, add:

```ts
    let skipParsedIndices: number[] | undefined;
    const raw = (data.fields as Record<string, { value?: unknown } | undefined>).skipParsedIndices?.value;
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          skipParsedIndices = parsed
            .map((v) => Number(v))
            .filter((n) => Number.isInteger(n) && n >= 0);
        }
      } catch {
        return reply.code(400).send({ error: 'skipParsedIndices must be a JSON array of integers' });
      }
    }
```

Then pass `skipParsedIndices` into `runImport({ ..., skipParsedIndices })`. Include `userSkipped` in the response body next to the existing counts.

- [ ] **Step 4: Type-check**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Full backend suite**

Run: `cd backend && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/domain/imports/import-service.ts \
        backend/src/http/routes/imports.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "$(cat <<'EOF'
feat(imports): runImport honors skipParsedIndices, stores userSkipped

POST /api/imports parses a JSON-encoded skipParsedIndices multipart
field. runImport drops those parsed indices before the INSERT and
records the count in file_imports.user_skipped. Invalid or out-of-range
indices are silently ignored.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Tighten the soft-dedup panel with fuzzy grouping

**Files:**
- Modify: `backend/src/http/routes/transactions/duplicates.ts`
- Create: `backend/src/http/routes/transactions/__tests__/duplicates.test.ts` (RUN_DB_TESTS=1)

**Interfaces:**
- Consumes: `LABEL_JACCARD_THRESHOLD`, `MAX_DAY_DELTA`, `MAX_AMOUNT_DELTA` from Task 2; `groupMinPairwiseSimilarity` from `backend/src/lib/label-similarity.ts`.
- Produces: `GET /api/transactions/duplicates` response shape unchanged (`{ groups: Array<{ accountId, date, amount, transactions[] }> }`), semantics tightened: fewer groups, all label-coherent.

- [ ] **Step 1: Write the DB-gated test**

Create `backend/src/http/routes/transactions/__tests__/duplicates.test.ts`:

```ts
// requires Postgres — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

const RUN = !!process.env.RUN_DB_TESTS;

let userId: number;
let accountId: number;

async function seed(rows: Array<{ date: string; amount: string; rawLabel: string }>) {
  const { db } = await import('../../../db/client.js');
  const { transactions } = await import('../../../db/schema.js');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    await db.insert(transactions).values({
      userId, accountId,
      date: r.date, amount: r.amount,
      rawLabel: r.rawLabel,
      normalizedLabel: r.rawLabel.toLowerCase(),
      dedupKey: `hash:seed-${i}-${r.rawLabel}`,
      memo: null, fitid: null,
    });
  }
}

describe.skipIf(!RUN)('GET /api/transactions/duplicates (fuzzy)', () => {
  beforeAll(async () => {
    const { db } = await import('../../../db/client.js');
    const { users, accounts } = await import('../../../db/schema.js');
    const [u] = await db.insert(users).values({
      username: 'duplicates-fuzzy-user', passwordHash: 'x',
    }).returning();
    userId = u!.id;
    const [a] = await db.insert(accounts).values({
      userId, name: 'Fuzzy Panel', type: 'checking', openingDate: '2025-01-01',
    }).returning();
    accountId = a!.id;
  });

  afterEach(async () => {
    const { db } = await import('../../../db/client.js');
    const { transactions } = await import('../../../db/schema.js');
    await db.delete(transactions);
  });

  it('hides groups whose labels are token-disjoint even at exact (date, amount)', async () => {
    await seed([
      { date: '2026-06-15', amount: '-25.30', rawLabel: 'CB CARREFOUR MARKET' },
      { date: '2026-06-15', amount: '-25.30', rawLabel: 'SNCF PARIS LYON' },
    ]);
    const { getDuplicates } = await import('../duplicates.js'); // testable export, see Step 2
    const result = await getDuplicates({ userId });
    expect(result.groups).toHaveLength(0);
  });

  it('surfaces groups with Jaccard-similar labels', async () => {
    await seed([
      { date: '2026-06-15', amount: '-25.30', rawLabel: 'CARREFOUR MARKET PARIS' },
      { date: '2026-06-15', amount: '-25.30', rawLabel: 'CB CARREFOUR MARKET PARIS' },
    ]);
    const { getDuplicates } = await import('../duplicates.js');
    const result = await getDuplicates({ userId });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.transactions).toHaveLength(2);
  });

  it('surfaces near-duplicates within Δdate=2 / Δamount=0.01', async () => {
    await seed([
      { date: '2026-06-15', amount: '-25.30', rawLabel: 'CARREFOUR MARKET' },
      { date: '2026-06-17', amount: '-25.31', rawLabel: 'CARREFOUR MARKET REF-98' },
    ]);
    const { getDuplicates } = await import('../duplicates.js');
    const result = await getDuplicates({ userId });
    expect(result.groups).toHaveLength(1);
  });

  it('excludes rows with transfer_group_id set', async () => {
    const { db } = await import('../../../db/client.js');
    const { transactions } = await import('../../../db/schema.js');
    await db.insert(transactions).values([
      {
        userId, accountId, date: '2026-06-15', amount: '-25.30',
        rawLabel: 'CARREFOUR', normalizedLabel: 'carrefour',
        dedupKey: 'hash:xfer-1', memo: null, fitid: null,
        transferGroupId: 'legacy-group',
      },
      {
        userId, accountId, date: '2026-06-15', amount: '-25.30',
        rawLabel: 'CARREFOUR PARIS', normalizedLabel: 'carrefour paris',
        dedupKey: 'hash:xfer-2', memo: null, fitid: null,
      },
    ]);
    const { getDuplicates } = await import('../duplicates.js');
    const result = await getDuplicates({ userId });
    expect(result.groups).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rewrite `duplicates.ts` with fuzzy grouping and expose `getDuplicates` for tests**

Replace the body of `backend/src/http/routes/transactions/duplicates.ts` with:

```ts
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { transactions } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import {
  MAX_DAY_DELTA,
  MAX_AMOUNT_DELTA,
  LABEL_JACCARD_THRESHOLD,
} from '../../../domain/dedup/fuzzy-match.js';
import { groupMinPairwiseSimilarity } from '../../../lib/label-similarity.js';

type Row = Record<string, unknown> & {
  id: number;
  account_id: number;
  date: string;
  amount: string;
  raw_label: string;
  not_duplicate: boolean;
};

export interface DuplicatesResponse {
  groups: Array<{
    accountId: number;
    date: string;
    amount: string;
    transactions: Row[];
  }>;
}

export async function getDuplicates(opts: {
  userId: number;
  accountIdFilter?: number | null;
}): Promise<DuplicatesResponse> {
  const rows = await db.execute<Row>(sql`
    SELECT t.*
    FROM transactions t
    WHERE t.user_id = ${opts.userId}
      AND t.transfer_group_id IS NULL
      ${opts.accountIdFilter ? sql`AND t.account_id = ${opts.accountIdFilter}` : sql``}
      AND EXISTS (
        SELECT 1 FROM transactions t2
        WHERE t2.user_id = t.user_id
          AND t2.account_id = t.account_id
          AND t2.id <> t.id
          AND t2.transfer_group_id IS NULL
          AND ABS(t2.date - t.date) <= ${MAX_DAY_DELTA}
          AND ABS(t2.amount::numeric - t.amount::numeric) <= ${MAX_AMOUNT_DELTA}
          AND SIGN(t2.amount::numeric) = SIGN(t.amount::numeric)
      )
    ORDER BY t.account_id, t.date DESC, t.amount, t.id
  `);

  const byAccount = new Map<number, Row[]>();
  for (const r of rows.rows) {
    const arr = byAccount.get(r.account_id) ?? [];
    arr.push(r);
    byAccount.set(r.account_id, arr);
  }

  const groups: DuplicatesResponse['groups'] = [];
  for (const [accountId, accountRows] of byAccount) {
    const parent = new Map<number, number>();
    const find = (x: number): number => {
      let cur = x;
      while (parent.get(cur) !== cur) {
        const p = parent.get(cur)!;
        parent.set(cur, parent.get(p)!);
        cur = parent.get(cur)!;
      }
      return cur;
    };
    for (const r of accountRows) parent.set(r.id, r.id);
    for (let i = 0; i < accountRows.length; i++) {
      for (let j = i + 1; j < accountRows.length; j++) {
        const a = accountRows[i]!;
        const b = accountRows[j]!;
        const dateDiff = Math.abs(dateToUtc(a.date) - dateToUtc(b.date)) / 86_400_000;
        if (dateDiff > MAX_DAY_DELTA) continue;
        if (Math.abs(Number(a.amount) - Number(b.amount)) > MAX_AMOUNT_DELTA + 1e-9) continue;
        if (Math.sign(Number(a.amount)) !== Math.sign(Number(b.amount))) continue;
        const ra = find(a.id);
        const rb = find(b.id);
        if (ra !== rb) parent.set(ra, rb);
      }
    }
    const byRoot = new Map<number, Row[]>();
    for (const r of accountRows) {
      const root = find(r.id);
      const arr = byRoot.get(root) ?? [];
      arr.push(r);
      byRoot.set(root, arr);
    }
    for (const [, members] of byRoot) {
      if (members.length < 2) continue;
      const labels = members.map((m) => m.raw_label);
      if (groupMinPairwiseSimilarity(labels) < LABEL_JACCARD_THRESHOLD) continue;
      if (members.every((m) => m.not_duplicate)) continue;
      members.sort((a, b) => (a.date === b.date ? a.id - b.id : a.date.localeCompare(b.date)));
      groups.push({
        accountId,
        date: members[0]!.date,
        amount: members[0]!.amount,
        transactions: members,
      });
    }
  }
  return { groups };
}

function dateToUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

export function registerDuplicateRoutes(app: FastifyInstance): void {
  app.get('/api/transactions/duplicates', async (req, reply) => {
    const uid = userId(req);
    const q = req.query as { accountId?: string };
    let accountIdFilter: number | null = null;
    if (q.accountId) {
      const n = Number(q.accountId);
      if (!Number.isInteger(n) || n <= 0) {
        return reply.code(400).send({ error: 'invalid accountId' });
      }
      accountIdFilter = n;
    }
    return getDuplicates({ userId: uid, accountIdFilter });
  });

  app.post('/api/transactions/mark-not-duplicate', async (req, reply) => {
    const uid = userId(req);
    const body = req.body as { ids?: unknown };
    if (!body || !Array.isArray(body.ids) || body.ids.length === 0) {
      return reply.code(400).send({ error: 'ids must be a non-empty array of integers' });
    }
    const ids: number[] = [];
    for (const v of body.ids) {
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) {
        return reply.code(400).send({ error: 'every id must be a positive integer' });
      }
      ids.push(n);
    }
    const updated = await db
      .update(transactions)
      .set({ notDuplicate: true })
      .where(and(eq(transactions.userId, uid), inArray(transactions.id, ids)))
      .returning({ id: transactions.id });
    return { updated: updated.length };
  });
}
```

- [ ] **Step 3: Type-check**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Full backend suite**

Run: `cd backend && npx vitest run`
Expected: PASS (DB-gated file skips without `RUN_DB_TESTS`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/routes/transactions/duplicates.ts \
        backend/src/http/routes/transactions/__tests__/duplicates.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "$(cat <<'EOF'
feat(duplicates): fuzzy grouping — widen tuple, filter by Jaccard

Groups are now connected components across (Δdate ≤ 3, Δamount ≤ 0.02,
same sign, transfer_group_id IS NULL), then dropped when
groupMinPairwiseSimilarity(labels) < 0.5. Wire shape unchanged. Group's
(date, amount) reports the earliest member for stable display.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Frontend API types + `apiUpload` extra fields

**Files:**
- Modify: `frontend/src/api/imports.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/__tests__/client.test.ts`

**Interfaces:**
- Consumes: none.
- Produces:
  - `ImportPreview.fuzzyDuplicateRows: Array<{ row: ImportPreviewRow; parsedIndex: number; matches: Array<{ txId: number; date: string; amount: string; rawLabel: string }> }>` — mirrors the backend shape.
  - `apiUpload<T>(path, file, { query?, fields? })` — the new `fields` map appends as extra `FormData` entries (strings).
  - New exported helper `commitImport(file, { accountId?, skipParsedIndices })` used by the preview hook in Task 9.

- [ ] **Step 1: Extend `apiUpload` — write the failing test first**

Add to `frontend/src/api/__tests__/client.test.ts` (inside the existing `describe('apiUpload()')`):

```ts
  it('appends extra form fields when `fields` is provided', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    await apiUpload('/api/imports', new File(['x'], 'x.csv'), {
      fields: { skipParsedIndices: '[0,2,5]' },
    });
    const [, init] = fetchMock.mock.calls[0]!;
    const form = init!.body as FormData;
    expect(form.get('skipParsedIndices')).toBe('[0,2,5]');
    fetchMock.mockRestore();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/api/__tests__/client.test.ts`
Expected: FAIL — the new key is not appended.

- [ ] **Step 3: Extend `apiUpload`**

In `frontend/src/api/client.ts`, change the signature and body:

```ts
export async function apiUpload<T>(
  path: string,
  file: File,
  opts?: { query?: Record<string, unknown>; fields?: Record<string, string> },
): Promise<T> {
  if (IS_DEMO) return demo.apiUpload<T>(path, file, opts);
  const url = new URL(path, window.location.origin);
  if (opts?.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }
  const form = new FormData();
  form.append('file', file, file.name);
  if (opts?.fields) {
    for (const [k, v] of Object.entries(opts.fields)) form.append(k, v);
  }
  const res = await fetch(url.pathname + url.search, {
    method: 'POST', credentials: 'include', body: form,
  });
  const { data } = await readAndValidateResponse(res, path);
  return data as T;
}
```

If `frontend/src/api/demo/index.ts::apiUpload` signature also takes `opts`, extend it to accept `fields` (pass-through; the demo handler may ignore it or record it — either is fine, but the signature must match).

- [ ] **Step 4: Verify the failing test now passes**

Run: `cd frontend && npx vitest run src/api/__tests__/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Extend `ImportPreview` type and add `commitImport`**

Rewrite `frontend/src/api/imports.ts`:

```ts
import { apiUpload } from './client';

export interface ImportPreviewRow {
  date: string;
  amount: string;
  rawLabel: string;
  memo: string | null;
}

export interface ImportPreviewFuzzyMatch {
  txId: number;
  date: string;
  amount: string;
  rawLabel: string;
}

export interface ImportPreviewFuzzyRow {
  row: ImportPreviewRow;
  parsedIndex: number;
  matches: ImportPreviewFuzzyMatch[];
}

export interface ImportPreview {
  filename: string;
  format: 'ofx' | 'csv' | 'camt';
  accountId: number;
  totalRows: number;
  newRows: ImportPreviewRow[];
  duplicateRows: ImportPreviewRow[];
  fuzzyDuplicateRows: ImportPreviewFuzzyRow[];
}

export interface ImportCommitResult {
  filename: string;
  insertedCount: number;
  dedupSkipped: number;
  userSkipped: number;
  totalLines: number;
}

export function previewImport(file: File, accountId?: number): Promise<ImportPreview> {
  return apiUpload<ImportPreview>(
    '/api/imports/preview',
    file,
    { query: accountId !== undefined ? { accountId } : undefined },
  );
}

export function commitImport(
  file: File,
  opts: { accountId?: number; skipParsedIndices: number[] },
): Promise<ImportCommitResult> {
  return apiUpload<ImportCommitResult>(
    '/api/imports',
    file,
    {
      query: opts.accountId !== undefined ? { accountId: opts.accountId } : undefined,
      fields: opts.skipParsedIndices.length
        ? { skipParsedIndices: JSON.stringify(opts.skipParsedIndices) }
        : undefined,
    },
  );
}
```

- [ ] **Step 6: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors (except any consumers of `ImportPreview` that need Task 8 updates — those are the modal + hook; if TS is unhappy on `preview.fuzzyDuplicateRows` in a test fixture, that fixture will be updated in Task 8 anyway).

- [ ] **Step 7: Run the frontend unit tests**

Run: `cd frontend && npx vitest run src/api`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/client.ts \
        frontend/src/api/imports.ts \
        frontend/src/api/__tests__/client.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "$(cat <<'EOF'
feat(imports/api): apiUpload accepts extra fields; commitImport helper

apiUpload gains a `fields` map appended as FormData entries. imports.ts
exports commitImport that JSON-encodes skipParsedIndices for the
multipart POST, plus the ImportPreview.fuzzyDuplicateRows type mirror.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `ImportPreviewModal` — fuzzy status, checkbox column, i18n

**Files:**
- Modify: `frontend/src/pages/Imports/ImportPreviewModal.tsx`
- Create: `frontend/src/pages/Imports/__tests__/ImportPreviewModal.fuzzy.test.tsx`
- Modify: `frontend/src/locales/fr/imports.json`
- Modify: `frontend/src/locales/en/imports.json`
- Modify: `frontend/src/pages/Imports/__tests__/ImportPreviewModal.test.tsx` (extend the existing preview fixture with an empty `fuzzyDuplicateRows: []` so old assertions keep passing).

**Interfaces:**
- Consumes: `ImportPreview` and `ImportPreviewFuzzyRow` from Task 7.
- Produces: `ImportPreviewModal` now takes an `onConfirm(skipParsedIndices: number[]): void` callback (was `onConfirm(): void`). Every caller passes the ticked-fuzzy-row parsed indices; Task 9 wires the caller.

- [ ] **Step 1: Add i18n keys**

In `frontend/src/locales/fr/imports.json`, under the existing `previewModal` block, add:

```jsonc
    "fuzzyCount_one": "{{count}} doublon probable",
    "fuzzyCount_other": "{{count}} doublons probables",
    "status": {
      "new": "Nouveau",
      "duplicate": "Doublon",
      "fuzzyDuplicate": "Probable"
    },
    "fuzzyMatchLabel": "correspond à",
    "fuzzySkipHeader": "Ignorer"
```

In `frontend/src/locales/en/imports.json`, mirror:

```jsonc
    "fuzzyCount_one": "{{count}} probable duplicate",
    "fuzzyCount_other": "{{count}} probable duplicates",
    "status": {
      "new": "New",
      "duplicate": "Duplicate",
      "fuzzyDuplicate": "Probable"
    },
    "fuzzyMatchLabel": "matches",
    "fuzzySkipHeader": "Skip"
```

Note — if `previewModal.status` already exists in a different shape (`status.new`, `status.duplicate`), edit inline instead of overwriting. Cross-check the existing keys before writing.

- [ ] **Step 2: Extend the existing modal test fixture**

In `frontend/src/pages/Imports/__tests__/ImportPreviewModal.test.tsx`, add `fuzzyDuplicateRows: []` to the `preview` object and to the `many` fixture inside the "collapses rows past 100" test. Existing assertions do not change.

- [ ] **Step 3: Write the new fuzzy-focused test**

Create `frontend/src/pages/Imports/__tests__/ImportPreviewModal.fuzzy.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportPreviewModal } from '../ImportPreviewModal';
import type { ImportPreview } from '../../../api/imports';
import { pinLocale } from '../../../test/i18n';

pinLocale('imports');

const preview: ImportPreview = {
  filename: 'juillet.csv',
  format: 'csv',
  accountId: 2,
  totalRows: 3,
  newRows: [
    { date: '2026-07-01', amount: '2000.00', rawLabel: 'Salaire', memo: null },
  ],
  duplicateRows: [
    { date: '2026-07-02', amount: '-10.00', rawLabel: 'Doublon exact', memo: null },
  ],
  fuzzyDuplicateRows: [
    {
      row: { date: '2026-07-03', amount: '-25.31', rawLabel: 'PAIEMENT CARREFOUR REF-98', memo: null },
      parsedIndex: 7,
      matches: [
        { txId: 42, date: '2026-07-01', amount: '-25.30', rawLabel: 'CB CARREFOUR MARKET' },
      ],
    },
  ],
};

describe('ImportPreviewModal — fuzzy rows', () => {
  it('renders a "Probable" status for the fuzzy row', () => {
    render(<ImportPreviewModal preview={preview} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Probable')).toBeInTheDocument();
  });

  it('shows a pre-ticked skip checkbox only on the fuzzy row', () => {
    render(<ImportPreviewModal preview={preview} onConfirm={() => {}} onCancel={() => {}} />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toBeChecked();
  });

  it('confirming while the box stays ticked sends parsedIndex 7 as skip', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ImportPreviewModal preview={preview} onConfirm={onConfirm} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Importer' }));
    expect(onConfirm).toHaveBeenCalledWith([7]);
  });

  it('un-ticking then confirming sends an empty skip list', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ImportPreviewModal preview={preview} onConfirm={onConfirm} onCancel={() => {}} />);
    await user.click(screen.getAllByRole('checkbox')[0]!);
    await user.click(screen.getByRole('button', { name: 'Importer' }));
    expect(onConfirm).toHaveBeenCalledWith([]);
  });
});
```

- [ ] **Step 4: Update `ImportPreviewModal.tsx`**

Modify `frontend/src/pages/Imports/ImportPreviewModal.tsx`:

- Change the callback prop: `onConfirm: (skipParsedIndices: number[]) => void`.
- Extend `Tagged` to `ImportPreviewRow & { status: 'new' | 'duplicate' | 'fuzzy-duplicate'; parsedIndex?: number }`. Only fuzzy rows have `parsedIndex`.
- Build the sorted `rows` array from all three inputs; add a fifth `<th>` for the skip checkbox column (visible header only when at least one fuzzy row exists). Each fuzzy row gets a checkbox `<td>` bound to a local `Set<number>` state initialized from `fuzzyDuplicateRows.map(r => r.parsedIndex)`.
- Header count line grows a third `<span>` using `previewModal.fuzzyCount_{one,other}` with `preview.fuzzyDuplicateRows.length`.
- On confirm click: `onConfirm(Array.from(tickedIndices))`.
- Preserve the 100-row collapse behavior; it operates on the merged `rows` array.
- Keep the file under 300 lines. If it grows past, split the row rendering into a small child component `PreviewRowLine` in the same file — do NOT extract to a new file (per the "no unrelated refactor" rule).

Sample state hook:

```tsx
  const [tickedSkips, setTickedSkips] = useState<Set<number>>(
    () => new Set(preview.fuzzyDuplicateRows.map((r) => r.parsedIndex)),
  );
  const toggleSkip = (idx: number) => {
    setTickedSkips((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };
```

The confirm button handler becomes:

```tsx
  <button
    type="button" className="btn-primary"
    onClick={() => onConfirm(Array.from(tickedSkips))}
    disabled={pending}
  >
    {pending ? t('previewModal.confirming', { ns: 'imports' }) : t('previewModal.confirm', { ns: 'imports' })}
  </button>
```

- [ ] **Step 5: Run the new fuzzy test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/Imports/__tests__/ImportPreviewModal.fuzzy.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the existing modal test — it must still pass**

Run: `cd frontend && npx vitest run src/pages/Imports/__tests__/ImportPreviewModal.test.tsx`
Expected: PASS.

- [ ] **Step 7: File-size guard**

Run: `wc -l frontend/src/pages/Imports/ImportPreviewModal.tsx`
Expected: ≤ 300. If not, split as described in Step 4.

- [ ] **Step 8: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/Imports/ImportPreviewModal.tsx \
        frontend/src/pages/Imports/__tests__/ImportPreviewModal.fuzzy.test.tsx \
        frontend/src/pages/Imports/__tests__/ImportPreviewModal.test.tsx \
        frontend/src/locales/fr/imports.json \
        frontend/src/locales/en/imports.json
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "$(cat <<'EOF'
feat(imports/ui): fuzzy row status + pre-ticked skip checkbox in preview

Third row status "Probable" surfaces fuzzyDuplicateRows with a skip
checkbox pre-ticked and a top-match hint. Un-ticking forces the row
into the import; onConfirm now emits the ticked parsedIndex list.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `useImportPreview` — plumb `skipParsedIndices` to commit

**Files:**
- Modify: `frontend/src/pages/Imports/useImportPreview.ts`
- Modify: `frontend/src/pages/Imports/__tests__/useImportPreview.test.tsx`
- Modify: `frontend/src/pages/Imports/UploadForm.tsx` (only if its call site of `previewCtl.confirm` needs to change; likely just passing the callback through — verify)

**Interfaces:**
- Consumes: `commitImport` + `ImportCommitResult` from Task 7; the new `onConfirm(skipParsedIndices)` signature from Task 8.
- Produces: `confirm(skipParsedIndices: number[])` on the returned hook object. `OfxCsvSuccess` gains `userSkipped`.

- [ ] **Step 1: Rewrite the hook test file**

The existing tests mock `apiUpload` and expect `confirm()` to take zero args. After Task 9, `confirm(skipParsedIndices)` calls `commitImport` (from `api/imports`), which internally calls `apiUpload`. Rewrite the mocks and the two impacted tests, then add a new test that asserts the skip list is forwarded verbatim.

Replace the whole file `frontend/src/pages/Imports/__tests__/useImportPreview.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useImportPreview } from '../useImportPreview';
import { pinLocale } from '../../../test/i18n';

pinLocale('imports');

vi.mock('../../../api/imports', () => ({
  previewImport: vi.fn(),
  commitImport: vi.fn(),
}));
import { previewImport, commitImport } from '../../../api/imports';
const previewMock = vi.mocked(previewImport);
const commitMock = vi.mocked(commitImport);

beforeEach(() => { previewMock.mockReset(); commitMock.mockReset(); });

const cbs = () => ({
  onImported: vi.fn(), onError: vi.fn(), onSuccess: vi.fn(), invalidate: vi.fn(),
});

function fixture(overrides: Partial<Awaited<ReturnType<typeof previewImport>>> = {}) {
  return {
    filename: 'x.csv', format: 'csv' as const, accountId: 3, totalRows: 1,
    newRows: [{ date: '2026-06-15', amount: '-1.00', rawLabel: 'X', memo: null }],
    duplicateRows: [],
    fuzzyDuplicateRows: [],
    ...overrides,
  };
}

describe('useImportPreview', () => {
  it('start() populates preview state with the returned ImportPreview', async () => {
    previewMock.mockResolvedValue(fixture());
    const c = cbs();
    const { result } = renderHook(() => useImportPreview(c));
    await act(async () => { await result.current.start(new File(['x'], 'x.csv'), 3); });
    expect(result.current.preview?.filename).toBe('x.csv');
    expect(c.onError).not.toHaveBeenCalled();
  });

  it('confirm() forwards an empty skip list and invokes onImported with userSkipped', async () => {
    previewMock.mockResolvedValue(fixture());
    commitMock.mockResolvedValue({
      filename: 'x.csv', insertedCount: 1, dedupSkipped: 0, userSkipped: 0, totalLines: 1,
    });
    const c = cbs();
    const { result } = renderHook(() => useImportPreview(c));
    const file = new File(['x'], 'x.csv');
    await act(async () => { await result.current.start(file, 3); });
    await act(async () => { await result.current.confirm([]); });
    expect(commitMock).toHaveBeenCalledWith(file, { accountId: 3, skipParsedIndices: [] });
    expect(c.onImported).toHaveBeenCalledWith({
      filename: 'x.csv', inserted: 1, skipped: 0, userSkipped: 0, total: 1,
    });
    expect(c.invalidate).toHaveBeenCalled();
    expect(c.onSuccess).toHaveBeenCalled();
    expect(result.current.preview).toBeNull();
  });

  it('confirm([7]) forwards the ticked parsedIndex to commitImport', async () => {
    previewMock.mockResolvedValue(fixture({
      totalRows: 4,
      newRows: [],
      duplicateRows: [],
      fuzzyDuplicateRows: [{
        row: { date: '2026-07-03', amount: '-25.31', rawLabel: 'CARREFOUR', memo: null },
        parsedIndex: 7,
        matches: [{ txId: 1, date: '2026-07-01', amount: '-25.30', rawLabel: 'CARREFOUR' }],
      }],
    }));
    commitMock.mockResolvedValue({
      filename: 'x.csv', insertedCount: 3, dedupSkipped: 0, userSkipped: 1, totalLines: 4,
    });
    const c = cbs();
    const { result } = renderHook(() => useImportPreview(c));
    const file = new File(['x'], 'x.csv');
    await act(async () => { await result.current.start(file, 3); });
    await act(async () => { await result.current.confirm([7]); });
    expect(commitMock).toHaveBeenCalledWith(file, { accountId: 3, skipParsedIndices: [7] });
    expect(c.onImported).toHaveBeenCalledWith({
      filename: 'x.csv', inserted: 3, skipped: 0, userSkipped: 1, total: 4,
    });
  });

  it('cancel() clears preview state without calling commitImport', async () => {
    previewMock.mockResolvedValue(fixture({ totalRows: 0, newRows: [], duplicateRows: [] }));
    const c = cbs();
    const { result } = renderHook(() => useImportPreview(c));
    await act(async () => { await result.current.start(new File(['x'], 'x.csv'), 3); });
    act(() => { result.current.cancel(); });
    expect(result.current.preview).toBeNull();
    expect(commitMock).not.toHaveBeenCalled();
  });

  it('preview error surfaces via onError and leaves preview null', async () => {
    previewMock.mockRejectedValue(new Error('boom'));
    const c = cbs();
    const { result } = renderHook(() => useImportPreview(c));
    await act(async () => { await result.current.start(new File(['x'], 'x.csv'), 3); });
    expect(c.onError).toHaveBeenCalled();
    expect(result.current.preview).toBeNull();
  });
});
```

- [ ] **Step 2: Rewrite `useImportPreview.ts`**

Change `frontend/src/pages/Imports/useImportPreview.ts` to use `commitImport`:

```ts
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { previewImport, commitImport, type ImportPreview } from '../../api/imports';
import { ApiError } from '../../api/client';

interface OfxCsvSuccess {
  filename: string;
  inserted: number;
  skipped: number;
  userSkipped: number;
  total: number;
}

export function useImportPreview(opts: {
  onImported: (result: OfxCsvSuccess) => void;
  onError: (message: string) => void;
  onSuccess: () => void;
  invalidate: () => void;
}) {
  const { t } = useTranslation('imports');
  const [state, setState] = useState<{
    file: File;
    data: ImportPreview;
    confirming: boolean;
  } | null>(null);

  const start = async (file: File, accountId?: number) => {
    try {
      const data = await previewImport(file, accountId);
      setState({ file, data, confirming: false });
    } catch (err) {
      opts.onError(err instanceof ApiError ? err.message : t('errors.previewFailed'));
    }
  };

  const confirm = async (skipParsedIndices: number[]) => {
    if (!state) return;
    setState({ ...state, confirming: true });
    try {
      const data = await commitImport(state.file, {
        accountId: state.data.accountId,
        skipParsedIndices,
      });
      opts.onImported({
        filename: state.file.name,
        inserted: data.insertedCount,
        skipped: data.dedupSkipped,
        userSkipped: data.userSkipped,
        total: data.totalLines,
      });
      opts.invalidate();
      setState(null);
      opts.onSuccess();
    } catch (err) {
      opts.onError(err instanceof ApiError ? err.message : t('errors.importFailed'));
      setState(null);
    }
  };

  const cancel = () => setState(null);

  return { preview: state?.data ?? null, pending: state?.confirming ?? false, start, confirm, cancel };
}
```

- [ ] **Step 3: Update `UploadForm.tsx`**

In `frontend/src/pages/Imports/UploadForm.tsx`, find the `<ImportPreviewModal .../>` call and change `onConfirm={previewCtl.confirm}` to `onConfirm={(skip) => previewCtl.confirm(skip)}` (or leave as-is if the reference already matches — TypeScript will tell you). Also update the toast/summary consumer to surface `userSkipped` if it's shown; a minimal change is fine.

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the hook test**

Run: `cd frontend && npx vitest run src/pages/Imports/__tests__/useImportPreview.test.tsx`
Expected: PASS.

- [ ] **Step 6: Full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/Imports/useImportPreview.ts \
        frontend/src/pages/Imports/UploadForm.tsx \
        frontend/src/pages/Imports/__tests__/useImportPreview.test.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "$(cat <<'EOF'
feat(imports/ui): confirm forwards fuzzy skip list to commitImport

useImportPreview.confirm now takes skipParsedIndices and calls
commitImport (multipart with the JSON-encoded skip list). Import
summary carries userSkipped forward for the results toast.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Playwright end-to-end

**Files:**
- Create: `frontend/e2e-fullstack/imports-fuzzy-dedup.spec.ts`

**Interfaces:**
- Consumes: real backend + real Playwright fixture, following the existing `fullstack.spec.ts` shape.
- Produces: a passing e2e run that exercises seed → upload near-duplicate → un-tick → verify both rows landed.

- [ ] **Step 1: Write the spec**

Create `frontend/e2e-fullstack/imports-fuzzy-dedup.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';
import { createAccount, dismissWelcomeTour } from '../e2e-shared/helpers';

const USERNAME = 'fuzzy-dedup-user';
const PASSWORD = 'athena-fuzzy-e2e-password';
const ACCOUNT_NAME = 'Compte fuzzy e2e';

test.describe.configure({ mode: 'serial' });

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input[autocomplete="username"]').fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('onboarding + account setup', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.locator('input[autocomplete="username"]').fill(USERNAME);
  const pw = page.locator('input[autocomplete="new-password"]');
  await pw.nth(0).fill(PASSWORD);
  await pw.nth(1).fill(PASSWORD);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL(/\/$/);
  await dismissWelcomeTour(page);
  await createAccount(page, ACCOUNT_NAME, '0,00');
});

test('near-duplicate is flagged and skippable at preview time', async ({ page }) => {
  await login(page);

  // Upload seed OFX with one transaction.
  const seed = Buffer.from(
    'Date;Libellé;Montant\n15/06/2026;CB CARREFOUR MARKET;-25,30\n', 'utf-8',
  );
  await page.goto('/imports');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'seed.csv', mimeType: 'text/csv', buffer: seed,
  });
  // The account picker in the preview modal — pick our account by name.
  await page.getByRole('combobox').selectOption({ label: ACCOUNT_NAME });
  await page.getByRole('button', { name: 'Importer' }).click();
  await expect(page.getByText(/inséré/)).toBeVisible();

  // Upload a near-duplicate: +1 day, +0.01€, tokenized-similar label.
  const near = Buffer.from(
    'Date;Libellé;Montant\n16/06/2026;PAIEMENT CARREFOUR MARKET REF98;-25,31\n', 'utf-8',
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: 'near.csv', mimeType: 'text/csv', buffer: near,
  });
  await page.getByRole('combobox').selectOption({ label: ACCOUNT_NAME });

  // Preview modal shows the row as "Probable" with a pre-ticked checkbox.
  await expect(page.getByText('Probable')).toBeVisible();
  const box = page.getByRole('checkbox').first();
  await expect(box).toBeChecked();

  // Un-tick and confirm.
  await box.click();
  await page.getByRole('button', { name: 'Importer' }).click();

  // Both rows now visible on the transactions page.
  await page.goto('/transactions');
  await expect(page.getByText('CB CARREFOUR MARKET')).toBeVisible();
  await expect(page.getByText('PAIEMENT CARREFOUR MARKET REF98')).toBeVisible();
});
```

- [ ] **Step 2: Locator sanity check**

Read the existing `UploadForm.tsx` and `ImportPreviewModal.tsx` to verify the selectors: the account combobox may be a native `<select>` (`selectOption` works) or a custom listbox (needs different targeting). Adjust the spec to match; leave the assertion set intact.

- [ ] **Step 3: Run the e2e locally (best-effort — DB gate)**

Playwright fullstack tests need a running backend (see `playwright.fullstack.config.ts`). If a local run isn't feasible on this machine, verify the spec compiles with a Playwright dry-run:

Run: `cd frontend && npx playwright test --config=playwright.fullstack.config.ts --list imports-fuzzy-dedup.spec.ts`
Expected: the two tests appear in the discovery output.

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e-fullstack/imports-fuzzy-dedup.spec.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "$(cat <<'EOF'
test(e2e): fuzzy dedup end-to-end — un-ticked probable row lands

Seed a transaction, upload a near-duplicate (+1d, +0.01€, matching
merchant token), verify the preview modal flags "Probable" with a
pre-ticked skip, un-tick, and confirm both rows are present on the
transactions page.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Post-implementation

- [ ] **Full verification pass**

Run in the repo root:
```
cd backend && npx vitest run
cd ../frontend && npx vitest run
```
Both suites pass. E2E left for the user to run against a live backend.

- [ ] **Manual smoke (optional but recommended)**

Start the app locally, register a fresh user, seed a CSV, upload a hand-crafted near-duplicate, observe the modal, un-tick, verify both rows land, then open the Imports page and confirm the file's summary shows the correct new counts (inserted / skipped / user-skipped).
