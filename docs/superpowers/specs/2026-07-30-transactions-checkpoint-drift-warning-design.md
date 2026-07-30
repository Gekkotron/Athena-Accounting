# Checkpoint drift warning on the Transactions page

**Date:** 2026-07-30
**Status:** approved

## Problem

On the Transactions page, an end-of-day row with a saved balance checkpoint
shows a sage filled bookmark in the SOLDE column — regardless of whether the
recalculated running balance still matches the amount that was frozen. The
dashboard Trend chart already distinguishes matching (sage) from diverged
(amber) checkpoints; the table gives no signal, so a diverged checkpoint
(meaning a transaction was edited, deleted, or back-imported since the
checkpoint was saved) goes unnoticed exactly where the user would fix it.

## Decision

Quiet, in-place warning: the bookmark turns amber with a small `!` when the
checkpoint has drifted, and its tooltip explains the divergence. No page-level
banner.

## Drift check

- `components/BalanceChart/checkpoints.ts` exports
  `isCheckpointDrifted(expected: number, actual: number): boolean` —
  `Math.abs(expected - actual) >= 0.01`, the existing `CHECKPOINT_TOLERANCE`.
  `buildCheckpointMarks` refactors to call it, so the chart and the table can
  never disagree on the threshold.
- `TransactionRow` computes
  `drifted = checkpoint != null && tx.runningBalance != null &&
  isCheckpointDrifted(Number(checkpoint.expectedAmount), Number(tx.runningBalance))`.
  A direct value comparison is correct here (no start-of-day/end-of-day
  ambiguity like the chart's): the checkpoint was created from this very
  row's end-of-day running balance via the same button.

## Visual

- Drifted: filled bookmark in amber (`text-amber-300 hover:text-amber-200`,
  the chart's drift color) plus a small `!` glyph beside the icon.
- Matching: unchanged (sage filled bookmark). No-checkpoint rows unchanged.
- Tooltip (`title`) when drifted:
  fr « Point de contrôle divergent — attendu {{expected}}, recalculé
  {{actual}} (Δ {{delta}}) », en "Checkpoint diverged — expected
  {{expected}}, recalculated {{actual}} (Δ {{delta}})". Amounts formatted
  with `formatAmount` in the account currency; delta signed (`+`/`−`,
  actual − expected). The same message is appended to the button's
  aria-label so the warning is perceivable without a pointer.
- Behavior unchanged: clicking the amber bookmark still removes the
  checkpoint; re-clicking re-saves it at the current balance — the natural
  "accept the new value" gesture, no new action introduced.

## Testing

- `TransactionRow` tests: drifted checkpoint → amber class + drift message in
  title; matching checkpoint → sage, no drift message; sub-tolerance
  difference (< 0.01) → no drift.
- `isCheckpointDrifted` covered through the existing
  `checkpoints.test.ts` suite (tolerance behavior already asserted via
  `buildCheckpointMarks`).

## Files

- Modify: `frontend/src/components/BalanceChart/checkpoints.ts`,
  `frontend/src/pages/Transactions/TransactionRow.tsx`,
  `frontend/src/locales/fr/transactions.json`,
  `frontend/src/locales/en/transactions.json`.
- Tests: `frontend/src/pages/Transactions/__tests__/TransactionRow.test.tsx`.
