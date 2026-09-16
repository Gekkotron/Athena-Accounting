import { describe, it, expect } from 'vitest';
import { TransactionRow } from '../TransactionRow';

// The Transactions page passes accountById + checkpointByDate maps and a
// suite of row handlers to every mounted row. When any of those references
// churn, every visible row re-renders — a keystroke in the search box costs
// N row renders even though the rows themselves haven't changed. The fix has
// two halves: (a) hoist the maps and handlers into useMemo/useCallback in the
// parent; (b) wrap TransactionRow in React.memo so the shallow-equal path
// short-circuits. This test pins the second half — the runtime tag is the
// only compile-time guarantee that memo is actually applied (a plain
// forwardRef would silently pass every other test in the file).
describe('TransactionRow memoization', () => {
  it('is wrapped in React.memo', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tag = (TransactionRow as any).$$typeof;
    expect(String(tag)).toContain('memo');
  });
});
