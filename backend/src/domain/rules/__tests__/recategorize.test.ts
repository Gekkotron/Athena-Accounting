import { describe, it, expect, vi, beforeEach } from 'vitest';

// Every query builder in the stub is a chainable, awaitable object. SELECT
// results are served from `state.selects` in call order; mutations are
// recorded in `state.ops` as { kind, table?, values? }.
const state = vi.hoisted(() => ({
  selects: [] as unknown[][],
  ops: [] as Array<{ kind: string; values?: unknown }>,
  txCount: 0,
}));

vi.mock('../../../db/client.js', () => {
  const makeSelect = () => {
    const rows = state.selects.shift() ?? [];
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy', 'limit']) chain[m] = () => chain;
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(res, rej);
    return chain;
  };
  const makeMutator = (kind: string) => (..._a: unknown[]) => {
    const op: { kind: string; values?: unknown } = { kind };
    state.ops.push(op);
    const chain: Record<string, unknown> = {
      set: (v: unknown) => { op.values = v; return chain; },
      values: (v: unknown) => { op.values = v; return chain; },
      where: () => chain,
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(undefined).then(res, rej),
    };
    return chain;
  };
  const runner = {
    select: () => makeSelect(),
    insert: makeMutator('insert'),
    update: makeMutator('update'),
    delete: makeMutator('delete'),
    execute: makeMutator('execute'),
  };
  return {
    db: {
      ...runner,
      transaction: async (fn: (tx: typeof runner) => Promise<unknown>) => {
        state.txCount++;
        return fn(runner);
      },
    },
  };
});

import { compileRule, type CompiledRule, type Rule } from '../matcher.js';
import {
  categorizeOne,
  emitAutoSplits,
  loadRuleEngine,
  recategorizeAll,
} from '../recategorize.js';

const mkRule = (o: Partial<Rule> = {}): Rule =>
  ({
    id: 1, userId: 1, keyword: 'carrefour', matchMode: 'word', signConstraint: 'any',
    categoryId: 10, priority: 0, enabled: true, ...o,
  }) as unknown as Rule;

const splitRule = (): CompiledRule => ({
  ...compileRule(mkRule({ keyword: 'resto', categoryId: 50 })),
  splits: [
    { categoryId: 1, percent: 33 },
    { categoryId: 2, percent: 33 },
    { categoryId: 3, percent: 34 },
  ],
});

beforeEach(() => {
  state.selects = [];
  state.ops = [];
  state.txCount = 0;
});

describe('emitAutoSplits', () => {
  it('returns 0 and writes nothing without ≥ 2 splits', async () => {
    const { db } = await import('../../../db/client.js');
    const plain = compileRule(mkRule());
    expect(await emitAutoSplits(db as never, 1, -10, plain)).toBe(0);
    const one = { ...plain, splits: [{ categoryId: 1, percent: 100 }] };
    expect(await emitAutoSplits(db as never, 1, -10, one)).toBe(0);
    expect(state.ops).toEqual([]);
  });

  it('returns 0 for a zero-amount parent', async () => {
    const { db } = await import('../../../db/client.js');
    expect(await emitAutoSplits(db as never, 1, 0, splitRule())).toBe(0);
    expect(state.ops).toEqual([]);
  });

  it('deletes old splits, inserts drift-free rows, stamps the parent', async () => {
    const { db } = await import('../../../db/client.js');
    const n = await emitAutoSplits(db as never, 7, -100.01, splitRule());
    expect(n).toBe(3);
    expect(state.ops.map((o) => o.kind)).toEqual(['delete', 'insert', 'update']);
    const rows = state.ops[1]!.values as Array<{ transactionId: number; categoryId: number; amount: string }>;
    expect(rows.map((r) => r.categoryId)).toEqual([1, 2, 3]);
    expect(rows.every((r) => r.transactionId === 7)).toBe(true);
    const sum = rows.reduce((a, r) => a + Math.round(Number(r.amount) * 100), 0);
    expect(sum).toBe(-10001);
    expect(state.ops[2]!.values).toEqual({ categoryId: 50, categorySource: 'auto', splitsSource: 'auto' });
  });
});

describe('categorizeOne', () => {
  it('applies a single-category rule', async () => {
    const res = await categorizeOne([compileRule(mkRule())], 99, 5, -12, 'carrefour city');
    expect(res).toEqual({ categoryId: 10, source: 'auto', emittedSplits: 0 });
    expect(state.ops).toHaveLength(1);
    expect(state.ops[0]).toEqual({ kind: 'update', values: { categoryId: 10, categorySource: 'auto' } });
  });

  it('emits splits when the matching rule has them', async () => {
    const res = await categorizeOne([splitRule()], 99, 5, -30, 'resto du coin');
    expect(res).toEqual({ categoryId: 50, source: 'auto', emittedSplits: 3 });
    expect(state.ops.map((o) => o.kind)).toEqual(['delete', 'insert', 'update']);
  });

  it('falls back to the default category with source "default"', async () => {
    const res = await categorizeOne([compileRule(mkRule())], 99, 5, -12, 'lidl');
    expect(res).toEqual({ categoryId: 99, source: 'default', emittedSplits: 0 });
    expect(state.ops[0]).toEqual({ kind: 'update', values: { categoryId: 99, categorySource: 'default' } });
  });

  it('writes nothing when there is no match and no default category', async () => {
    const res = await categorizeOne([], null, 5, -12, 'lidl');
    expect(res).toEqual({ categoryId: null, source: 'default', emittedSplits: 0 });
    expect(state.ops).toEqual([]);
  });

  it('honors rule order (first match wins)', async () => {
    const list = [compileRule(mkRule({ id: 1, categoryId: 1, keyword: 'amazon' })), compileRule(mkRule({ id: 2, categoryId: 2, keyword: 'amazon' }))];
    const res = await categorizeOne(list, null, 5, -12, 'amazon');
    expect(res.categoryId).toBe(1);
  });
});

describe('loadRuleEngine', () => {
  it('returns no rules and the default category when the user has none', async () => {
    state.selects = [[], [{ id: 77 }]];
    const eng = await loadRuleEngine(1);
    expect(eng.compiled).toEqual([]);
    expect(eng.defaultId).toBe(77);
  });

  it('attaches splits only to rules with ≥ 2 rule_splits rows', async () => {
    state.selects = [
      [mkRule({ id: 1 }), mkRule({ id: 2, keyword: 'resto' }), mkRule({ id: 3, keyword: 'solo' })],
      [],
      [
        { ruleId: 2, categoryId: 1, percent: 50, position: 0 },
        { ruleId: 2, categoryId: 2, percent: 50, position: 1 },
        { ruleId: 3, categoryId: 1, percent: 100, position: 0 },
      ],
    ];
    const eng = await loadRuleEngine(1);
    expect(eng.compiled).toHaveLength(3);
    expect(eng.compiled[0]!.splits).toBeUndefined();
    expect(eng.compiled[1]!.splits).toEqual([
      { categoryId: 1, percent: 50 },
      { categoryId: 2, percent: 50 },
    ]);
    expect(eng.compiled[2]!.splits).toBeUndefined();
    expect(eng.defaultId).toBeNull();
  });
});

describe('recategorizeAll', () => {
  const t = (o: Record<string, unknown>) => ({
    id: 1, amount: '-10.00', normalizedLabel: 'carrefour', categorySource: null, splitsSource: null, ...o,
  });

  it('buckets matched rows per category and unmatched rows to the default', async () => {
    state.selects = [
      [mkRule({ id: 1, categoryId: 10 })],
      [],
      [{ id: 5 }],
      [t({ id: 1 }), t({ id: 2 }), t({ id: 3, normalizedLabel: 'lidl' })],
    ];
    const res = await recategorizeAll({ userId: 1, preserveManual: true });
    expect(res).toEqual({ total: 3, recategorized: 2, splitsEmitted: 0, unknown: 1, preserved: 0 });
    const updates = state.ops.filter((o) => o.kind === 'update').map((o) => o.values);
    expect(updates).toEqual([
      { categoryId: 10, categorySource: 'auto' },
      { categoryId: 5, categorySource: 'default' },
    ]);
  });

  it('preserves manual categories only when preserveManual is set', async () => {
    const setup = () => {
      state.ops = [];
      state.selects = [[mkRule()], [], [{ id: 5 }], [t({ categorySource: 'manual' })]];
    };
    setup();
    expect(await recategorizeAll({ userId: 1, preserveManual: true })).toMatchObject({ preserved: 1, recategorized: 0 });
    expect(state.ops).toEqual([]);
    setup();
    expect(await recategorizeAll({ userId: 1, preserveManual: false })).toMatchObject({ preserved: 0, recategorized: 1 });
  });

  it('always preserves manual splits, even with preserveManual false', async () => {
    state.selects = [[mkRule()], [], [{ id: 5 }], [t({ splitsSource: 'manual' })]];
    const res = await recategorizeAll({ userId: 1, preserveManual: false });
    expect(res.preserved).toBe(1);
    expect(state.ops).toEqual([]);
  });

  it('clears auto splits for rows that no longer match a split rule', async () => {
    state.selects = [
      [mkRule()],
      [],
      [{ id: 5 }],
      [t({ id: 1, splitsSource: 'auto' }), t({ id: 2, normalizedLabel: 'lidl', splitsSource: 'auto' })],
    ];
    await recategorizeAll({ userId: 1, preserveManual: true });
    expect(state.txCount).toBe(1);
    expect(state.ops[0]!.kind).toBe('delete');
    expect(state.ops[1]).toEqual({ kind: 'update', values: { splitsSource: null } });
  });

  it('emits splits in a single transaction for split-mode matches', async () => {
    state.selects = [
      [mkRule({ id: 2, keyword: 'resto', categoryId: 50 })],
      [
        { ruleId: 2, categoryId: 1, percent: 60, position: 0 },
        { ruleId: 2, categoryId: 2, percent: 40, position: 1 },
      ],
      [{ id: 5 }],
      [t({ id: 9, amount: '-33.33', normalizedLabel: 'resto du coin' }), t({ id: 10, amount: '0.00', normalizedLabel: 'resto du coin' })],
    ];
    const res = await recategorizeAll({ userId: 1, preserveManual: true });
    expect(res).toMatchObject({ total: 2, splitsEmitted: 2, recategorized: 0 });
    expect(state.txCount).toBe(1);
    expect(state.ops.map((o) => o.kind)).toEqual(['delete', 'insert', 'execute']);
    const rows = state.ops[1]!.values as Array<{ transactionId: number; amount: string }>;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.transactionId === 9)).toBe(true);
    const sum = rows.reduce((a, r) => a + Math.round(Number(r.amount) * 100), 0);
    expect(sum).toBe(-3333);
  });

  it('skips the default bucket when the user has no default category', async () => {
    state.selects = [[], [], [t({ normalizedLabel: 'lidl' })]];
    const res = await recategorizeAll({ userId: 1, preserveManual: true });
    expect(res.unknown).toBe(1);
    expect(state.ops).toEqual([]);
  });
});
