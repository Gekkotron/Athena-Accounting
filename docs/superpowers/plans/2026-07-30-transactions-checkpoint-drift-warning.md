# Transactions Checkpoint Drift Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Transactions-page checkpoint bookmark amber, with an explanatory tooltip, when the saved checkpoint amount no longer matches the recomputed running balance.

**Architecture:** The drift threshold already lives in `components/BalanceChart/checkpoints.ts` (`CHECKPOINT_TOLERANCE = 0.01`); export it via a tiny `isCheckpointDrifted` helper and refactor `buildCheckpointMarks` to use it, then have `TransactionRow` call the same helper to style the bookmark and build the tooltip. No new state, queries, or actions — the existing toggle behavior is untouched.

**Tech Stack:** React + TypeScript, i18next, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-30-transactions-checkpoint-drift-warning-design.md`

## Global Constraints

- Commit identity: every commit uses `git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit …` and ends the message with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Commit directly to `main`. Do NOT push — the user pushes explicitly.
- i18n: any user-facing string goes in BOTH `frontend/src/locales/fr/` and `frontend/src/locales/en/` — the i18n smoke test checks parity. The row tests render French (`pinLocale('transactions')` pins fr).
- ESLint `max-lines`: 300 per file (blanks/comments skipped); `TransactionRow.tsx` is at ~219 raw lines, the diff adds ~15 — fine.
- Drift color is the chart's: amber `text-amber-300` (drifted) vs sage `text-sage-300` (matching).
- All commands run from `frontend/`: `cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/frontend`.

---

### Task 1: Export `isCheckpointDrifted` from the chart's checkpoint module

**Files:**
- Modify: `frontend/src/components/BalanceChart/checkpoints.ts:16` (the `CHECKPOINT_TOLERANCE` area) and `:61` (the `drift` computation)
- Test: `frontend/src/components/BalanceChart/__tests__/checkpoints.test.ts` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces (Task 2 relies on this exact name):

```ts
export function isCheckpointDrifted(expected: number, actual: number): boolean
```

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/components/BalanceChart/__tests__/checkpoints.test.ts` (add `isCheckpointDrifted` to the existing import from `../checkpoints`):

```ts
describe('isCheckpointDrifted', () => {
  it('drifts at exactly the 0.01 tolerance', () => {
    expect(isCheckpointDrifted(100, 100.01)).toBe(true);
    expect(isCheckpointDrifted(100.01, 100)).toBe(true);
  });

  it('does not drift below the tolerance', () => {
    expect(isCheckpointDrifted(100, 100.009)).toBe(false);
    expect(isCheckpointDrifted(100, 100)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/BalanceChart/__tests__/checkpoints.test.ts`
Expected: FAIL — `isCheckpointDrifted` is not exported.

- [ ] **Step 3: Implement**

In `frontend/src/components/BalanceChart/checkpoints.ts`, replace

```ts
const CHECKPOINT_TOLERANCE = 0.01;
```

with

```ts
const CHECKPOINT_TOLERANCE = 0.01;

// Shared drift predicate — the Trend chart's diamonds and the Transactions
// table's bookmark both use it, so the two surfaces can never disagree on
// what counts as a diverged checkpoint.
export function isCheckpointDrifted(expected: number, actual: number): boolean {
  return Math.abs(expected - actual) >= CHECKPOINT_TOLERANCE;
}
```

and in `buildCheckpointMarks`, replace

```ts
      const drift = Math.abs(delta) >= CHECKPOINT_TOLERANCE;
```

with

```ts
      const drift = isCheckpointDrifted(c.expectedAmount, actual);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/BalanceChart/__tests__/checkpoints.test.ts`
Expected: PASS — the new describe block plus all pre-existing `buildCheckpointMarks` tests (the refactor must not change their outcomes).

- [ ] **Step 5: Commit**

```bash
git add src/components/BalanceChart/checkpoints.ts src/components/BalanceChart/__tests__/checkpoints.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "refactor(charts): export the checkpoint drift predicate

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Amber drifted bookmark + tooltip in TransactionRow

**Files:**
- Modify: `frontend/src/pages/Transactions/TransactionRow.tsx` (imports; the checkpoint button at lines ~139-163)
- Modify: `frontend/src/locales/fr/transactions.json`, `frontend/src/locales/en/transactions.json` (one key each under `"row"`)
- Test: `frontend/src/pages/Transactions/__tests__/TransactionRow.test.tsx` (append)

**Interfaces:**
- Consumes: `isCheckpointDrifted(expected: number, actual: number): boolean` from `../../components/BalanceChart/checkpoints` (Task 1); existing `formatAmount(value: string | number, currency?: string): string` from `../../lib/format`.
- Produces: nothing consumed later.

- [ ] **Step 1: Add the i18n keys**

In `frontend/src/locales/fr/transactions.json`, inside the `"row"` object, right after `"checkpointTitle"`:

```json
"checkpointDrift": "Point de contrôle divergent — attendu {{expected}}, recalculé {{actual}} (Δ {{delta}})",
```

In `frontend/src/locales/en/transactions.json`, same position:

```json
"checkpointDrift": "Checkpoint diverged — expected {{expected}}, recalculated {{actual}} (Δ {{delta}})",
```

- [ ] **Step 2: Write the failing tests**

Append to `frontend/src/pages/Transactions/__tests__/TransactionRow.test.tsx`:

```tsx
describe('TransactionRow checkpoint drift warning', () => {
  const txWithBalance: Transaction = { ...t, runningBalance: '1307.86' };
  const cpLabel = /valider le solde/i;
  function cp(expectedAmount: string): BalanceCheckpoint {
    return {
      id: 3, accountId: 1, checkpointDate: '2026-06-15', expectedAmount, note: null, createdAt: '2026-06-15T00:00:00Z',
    };
  }

  it('turns the pin amber with a drift tooltip when the checkpoint diverges', () => {
    renderRow({ tx: txWithBalance, showBalance: true, isEndOfDay: true, checkpoint: cp('1250.00') });
    const btn = screen.getByRole('button', { name: cpLabel });
    expect(btn.className).toContain('text-amber-300');
    const title = btn.getAttribute('title') ?? '';
    expect(title).toMatch(/divergent/i);
    expect(title).toMatch(/1\s250,00/); // expected (fr formatting, non-breaking spaces)
    expect(title).toMatch(/1\s307,86/); // recalculated
    expect(title).toMatch(/\+/); // signed delta (actual − expected = +57,86)
  });

  it('keeps the sage pin and the normal tooltip when the checkpoint matches', () => {
    renderRow({ tx: txWithBalance, showBalance: true, isEndOfDay: true, checkpoint: cp('1307.86') });
    const btn = screen.getByRole('button', { name: cpLabel });
    expect(btn.className).toContain('text-sage-300');
    expect(btn.getAttribute('title') ?? '').not.toMatch(/divergent/i);
  });

  it('ignores sub-tolerance differences (< 0.01)', () => {
    renderRow({ tx: txWithBalance, showBalance: true, isEndOfDay: true, checkpoint: cp('1307.855') });
    const btn = screen.getByRole('button', { name: cpLabel });
    expect(btn.className).toContain('text-sage-300');
    expect(btn.getAttribute('title') ?? '').not.toMatch(/divergent/i);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/pages/Transactions/__tests__/TransactionRow.test.tsx`
Expected: FAIL — the three new tests (no amber class, no drift tooltip); all pre-existing tests still pass.

- [ ] **Step 4: Implement in `TransactionRow.tsx`**

Add imports:

```ts
import { isCheckpointDrifted } from '../../components/BalanceChart/checkpoints';
```

(`formatAmount` is already imported from `../../lib/format`.)

Inside the component body, right after `const catById = …`, add:

```ts
  const currency = account?.currency ?? 'EUR';
  // Amber warning when the saved checkpoint no longer matches the recomputed
  // running balance — a transaction was edited, deleted, or back-imported
  // since the balance was frozen. Direct value comparison is correct here
  // (unlike the chart's start/end-of-day disambiguation): the checkpoint was
  // created from this very row's end-of-day running balance.
  const checkpointDelta =
    checkpoint != null && tx.runningBalance != null
      ? Number(tx.runningBalance) - Number(checkpoint.expectedAmount)
      : null;
  const checkpointDrifted =
    checkpoint != null &&
    tx.runningBalance != null &&
    isCheckpointDrifted(Number(checkpoint.expectedAmount), Number(tx.runningBalance));
  const driftMessage = checkpointDrifted
    ? t('row.checkpointDrift', {
        expected: formatAmount(checkpoint!.expectedAmount, currency),
        actual: formatAmount(tx.runningBalance!, currency),
        delta: `${(checkpointDelta ?? 0) >= 0 ? '+' : ''}${formatAmount(checkpointDelta ?? 0, currency)}`,
      })
    : null;
```

Update the checkpoint button (lines ~140-162). Three changes — `aria-label`, `title`, and the pressed-state class — plus a `!` glyph before the SVG when drifted:

```tsx
                <button
                  type="button"
                  onClick={() => onToggleCheckpoint(tx, !(checkpoint != null))}
                  disabled={checkpointPending}
                  aria-pressed={checkpoint != null}
                  aria-label={`${t('row.checkpointAriaLabel', { date: formatDate(tx.date) })}${driftMessage ? ` — ${driftMessage}` : ''}`}
                  title={driftMessage ?? t('row.checkpointTitle')}
                  className={`inline-flex items-center gap-0.5 rounded p-0.5 transition disabled:opacity-40 disabled:cursor-wait ${
                    checkpoint != null
                      ? checkpointDrifted
                        ? 'text-amber-300 hover:text-amber-200'
                        : 'text-sage-300 hover:text-sage-200'
                      : 'text-ink-600 hover:text-sage-300 hover:bg-ink-900'
                  }`}
                >
                  {checkpointDrifted && (
                    <span className="text-[10px] font-bold leading-none" aria-hidden>!</span>
                  )}
                  {checkpoint != null ? (
                    <svg width="11" height="13" viewBox="0 0 12 14" fill="currentColor" aria-hidden>
                      <path d="M2 1h8v11.2L6 9.6 2 12.2z" />
                    </svg>
                  ) : (
                    <svg width="11" height="13" viewBox="0 0 12 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
                      <path d="M2.5 1.5h7v9.7L6 9.05 2.5 11.2z" />
                    </svg>
                  )}
                </button>
```

(The only differences from the current JSX: the `aria-label` template, the `title` value, `gap-0.5` in the class list, the nested drift/matching class ternary, and the `!` span.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/pages/Transactions/__tests__/TransactionRow.test.tsx`
Expected: PASS — 3 new tests plus all pre-existing ones (the aria-label keeps its prefix, so `cpLabel` regex matches still work).

- [ ] **Step 6: Full suite, lint, typecheck**

Run: `npx vitest run`
Expected: PASS, including the i18n smoke test (fr/en key parity).

Run: `npx tsc -b`
Expected: no errors.

Run: `npx eslint src/pages/Transactions/TransactionRow.tsx src/components/BalanceChart/checkpoints.ts`
Expected: no errors (warnings pre-existing elsewhere are out of scope).

- [ ] **Step 7: Commit**

```bash
git add src/pages/Transactions/TransactionRow.tsx src/locales/fr/transactions.json src/locales/en/transactions.json src/pages/Transactions/__tests__/TransactionRow.test.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(transactions): amber drift warning on diverged checkpoints

The bookmark in the SOLDE column now compares the saved checkpoint amount
against the recomputed running balance and turns amber with an
expected/recalculated/delta tooltip when they no longer match — same
tolerance and color as the Trend chart's drift diamonds.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
