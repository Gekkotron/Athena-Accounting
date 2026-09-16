import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { notificationHookFailuresTotal } from '../../../lib/hook-metrics.js';

// hooks.ts wraps every side effect in a try/catch and used to swallow
// failures via console.error. reportHookError now bumps a shared
// prom-client counter and logs at warn level, so a broken hook shows up
// on the scrape target and in log dashboards instead of silently
// degrading. We drive the failure path via afterBankSyncCompleted with a
// mocked `db` client — its loadPrefs is the first DB call it makes.

describe('hook error reporting', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    notificationHookFailuresTotal.reset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.resetModules();
  });
  afterEach(() => {
    warnSpy.mockRestore();
    vi.doUnmock('../../../db/client.js');
  });

  it('bumps notification_hook_failures_total{hook=…} and warn-logs when a hook throws', async () => {
    vi.doMock('../../../db/client.js', () => ({
      db: { select: () => { throw new Error('forced-fail'); } },
    }));
    const { afterBankSyncCompleted } = await import('../hooks.js');
    const { notificationHookFailuresTotal: counter } = await import('../../../lib/hook-metrics.js');
    counter.reset();

    await afterBankSyncCompleted(1, 2, false, 'boom');

    const metric = await counter.get();
    const value = metric.values.find((v) => v.labels.hook === 'afterBankSyncCompleted')?.value ?? 0;
    expect(value).toBe(1);

    expect(warnSpy).toHaveBeenCalled();
    const msg = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(msg).toContain('afterBankSyncCompleted');
  });
});
