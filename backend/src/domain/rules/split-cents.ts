// Scale a parent amount (in cents) across a percent list, absorbing any
// rounding drift into the last row so the sum matches the parent exactly.
// The rule engine emits transaction_splits from this output; the deferrable
// trigger installed by migration 0014 requires SUM(splits.amount) =
// parent.amount, so drift absorption is a correctness requirement, not a
// polish. See docs/superpowers/specs/2026-09-16-rule-auto-splits-design.md.
export function computeSplitCents(parentCents: number, percents: readonly number[]): number[] {
  if (percents.length === 0) {
    throw new Error('computeSplitCents requires at least one percent');
  }
  const total = percents.reduce((a, b) => a + b, 0);
  if (total !== 100) {
    throw new Error(`computeSplitCents: percents must sum to 100 (got ${total})`);
  }

  const cents = percents.map((p) => Math.round((parentCents * p) / 100));
  const drift = parentCents - cents.reduce((a, b) => a + b, 0);
  cents[cents.length - 1]! += drift;
  return cents;
}
