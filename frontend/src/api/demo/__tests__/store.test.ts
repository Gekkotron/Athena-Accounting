import { describe, it, expect, beforeEach } from 'vitest';
import { getState, reset, setState, registerSeedProvider, __resetForTest } from '../store';
import { buildSeedState, SEED_META } from '../seed';

describe('demo store + seed', () => {
  beforeEach(() => {
    __resetForTest();
    registerSeedProvider(buildSeedState);
  });

  it('hydrates from the seed on first getState', () => {
    const state = getState();
    expect(state.v).toBe(2);
    expect(state.accounts).toHaveLength(2);
    expect(state.categories).toHaveLength(11);
    expect(state.rules).toHaveLength(9);
    expect(state.budgets).toHaveLength(4);
    expect(state.balanceCheckpoints).toHaveLength(1);
    expect(state.transactions.length).toBeGreaterThan(150);
    expect((state.recurring ?? []).length).toBe(12);
  });

  it('reset() restores exactly the seed', () => {
    const initialCategories = getState().categories.length;
    const initialTransactions = getState().transactions.length;
    setState((draft) => {
      draft.categories.push({
        id: 999, name: 'X', kind: 'expense', color: null,
        parentId: null, isDefault: false, isInternalTransfer: false,
      });
      draft.transactions.length = 0;
    });
    expect(getState().categories).toHaveLength(initialCategories + 1);
    expect(getState().transactions).toHaveLength(0);

    reset();
    const afterReset = getState();
    expect(afterReset.categories).toHaveLength(initialCategories);
    expect(afterReset.transactions.length).toBe(initialTransactions);
  });

  it('seed checkpoint matches the computed balance at checkpoint date', () => {
    const state = getState();
    const cp = state.balanceCheckpoints[0] as { accountId: number; checkpointDate: string; expectedAmount: string };
    const opening = Number(state.accounts.find((a) => a.id === cp.accountId)!.openingBalance);
    const sumBefore = (state.transactions as Array<{ accountId: number; date: string; amount: string }>).reduce(
      (s, t) => (t.accountId === cp.accountId && t.date <= cp.checkpointDate ? s + Number(t.amount) : s),
      opening,
    );
    expect(Number(cp.expectedAmount)).toBeCloseTo(sumBefore, 2);
  });

  it('exposes SEED_META constants for handler tests', () => {
    expect(SEED_META.today).toBe('2026-07-18');
    expect(SEED_META.accountIds.Courant).toBe(1);
    expect(SEED_META.categoryIds.Salaire).toBe(8);
  });
});
