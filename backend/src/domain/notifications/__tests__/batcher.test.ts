import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { queueBatched, flushBatch, __setEmitter, IDLE_MS, MAX_ITEMS } from '../batcher.js';

describe('batcher', () => {
  const emit = vi.fn(async (_uid: number, _kind: string, _payload: unknown, _opts?: unknown) => null);
  beforeEach(() => { __setEmitter(emit); emit.mockClear(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('flushes after IDLE_MS with a summary payload', async () => {
    queueBatched(1, 'bt:9', { accountId: 9, amount: 500 });
    queueBatched(1, 'bt:9', { accountId: 9, amount: 700 });
    await vi.advanceTimersByTimeAsync(IDLE_MS + 10);
    expect(emit).toHaveBeenCalledTimes(1);
    const [uid, kind, payload] = emit.mock.calls[0]!;
    expect(uid).toBe(1);
    expect(kind).toBe('big_transaction');
    expect((payload as any).summary).toEqual({ accountId: 9, count: 2, total: 1200 });
  });

  it('flushes immediately at MAX_ITEMS', async () => {
    for (let i = 0; i < MAX_ITEMS; i++) queueBatched(2, 'bt:1', { accountId: 1, amount: 100 });
    await vi.advanceTimersByTimeAsync(0);
    expect(emit).toHaveBeenCalledTimes(1);
    expect((emit.mock.calls[0]![2] as any).summary.count).toBe(MAX_ITEMS);
  });

  it('emits a single (not summary) when only one item ever queued', async () => {
    queueBatched(3, 'bt:2', { accountId: 2, amount: 999 });
    await flushBatch(3, 'bt:2');
    expect(emit).toHaveBeenCalledTimes(1);
    expect((emit.mock.calls[0]![2] as any).single).toBeUndefined(); // batcher always summarises
  });
});
