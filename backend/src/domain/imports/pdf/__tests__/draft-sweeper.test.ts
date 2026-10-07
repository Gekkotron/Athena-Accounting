import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const returning = vi.fn();
const where = vi.fn(() => ({ returning }));
const del = vi.fn(() => ({ where }));

vi.mock('../../../../db/client.js', () => ({
  db: { delete: (...a: unknown[]) => del(...(a as [])) },
}));

import { sweepExpiredDrafts, startDraftSweeper } from '../draft-sweeper.js';

beforeEach(() => {
  returning.mockReset();
  where.mockClear();
  del.mockClear();
});

describe('sweepExpiredDrafts', () => {
  it('returns the number of deleted drafts', async () => {
    returning.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(await sweepExpiredDrafts()).toBe(3);
  });

  it('invokes onAborted with the count when something was deleted', async () => {
    returning.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const cb = vi.fn();
    await sweepExpiredDrafts(cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(2);
  });

  it('does not invoke onAborted when nothing expired', async () => {
    returning.mockResolvedValue([]);
    const cb = vi.fn();
    expect(await sweepExpiredDrafts(cb)).toBe(0);
    expect(cb).not.toHaveBeenCalled();
  });

  it('works without a callback', async () => {
    returning.mockResolvedValue([{ id: 1 }]);
    await expect(sweepExpiredDrafts()).resolves.toBe(1);
  });
});

describe('startDraftSweeper', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const mkApp = (withMetrics: boolean) => {
    const hooks: Record<string, () => Promise<void>> = {};
    const inc = vi.fn();
    const app = {
      log: { error: vi.fn() },
      addHook: (name: string, fn: () => Promise<void>) => { hooks[name] = fn; },
      ...(withMetrics ? { metrics: { importsTotal: { inc } } } : {}),
    };
    return { app: app as never, hooks, inc, log: app.log };
  };

  it('sweeps once immediately and then every hour', async () => {
    returning.mockResolvedValue([]);
    const { app } = mkApp(false);
    startDraftSweeper(app);
    await vi.advanceTimersByTimeAsync(0);
    expect(del).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(del).toHaveBeenCalledTimes(2);
  });

  it('bumps the aborted-pdf import metric by the number of swept drafts', async () => {
    returning.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const { app, inc } = mkApp(true);
    startDraftSweeper(app);
    await vi.advanceTimersByTimeAsync(0);
    expect(inc).toHaveBeenCalledWith({ kind: 'pdf', outcome: 'aborted' }, 2);
  });

  it('tolerates an app without metrics', async () => {
    returning.mockResolvedValue([{ id: 1 }]);
    const { app, log } = mkApp(false);
    startDraftSweeper(app);
    await vi.advanceTimersByTimeAsync(0);
    expect(log.error).not.toHaveBeenCalled();
  });

  it('logs and survives a failing sweep', async () => {
    returning.mockRejectedValue(new Error('db down'));
    const { app, log } = mkApp(false);
    startDraftSweeper(app);
    await vi.advanceTimersByTimeAsync(0);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('stops the interval on app close', async () => {
    returning.mockResolvedValue([]);
    const { app, hooks } = mkApp(false);
    startDraftSweeper(app);
    await vi.advanceTimersByTimeAsync(0);
    await hooks.onClose!();
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
    expect(del).toHaveBeenCalledTimes(1);
  });
});
