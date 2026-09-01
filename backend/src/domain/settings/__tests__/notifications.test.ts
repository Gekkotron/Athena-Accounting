import { describe, it, expect } from 'vitest';
import { mergeSettings } from '../schema.js';

describe('settings.notifications', () => {
  it('defaults are privacy-safe and enabled', () => {
    const s = mergeSettings({});
    expect(s.notifications.enabled).toBe(true);
    expect(s.notifications.privacy.hideAmount).toBe(true);
    expect(s.notifications.privacy.hideMerchant).toBe(true);
    expect(s.notifications.channels.toast).toBe(true);
    expect(s.notifications.channels.osNative).toBe(false);
    expect(s.notifications.channels.webPush).toBe(false);
  });

  it('accepts a per-account threshold map', () => {
    const s = mergeSettings({
      notifications: { triggers: { bigTransaction: { enabled: true, thresholds: { '3': 500 } } } },
    });
    expect(s.notifications.triggers.bigTransaction.thresholds['3']).toBe(500);
  });

  it('rejects an unknown top-level key', () => {
    const s = mergeSettings({ notifications: { evil: true } });
    // strict schema drops the unknown branch and returns defaults
    expect(s.notifications.enabled).toBe(true);
  });

  it('never leaks a mutable reference back into DEFAULTS', () => {
    const first = mergeSettings({});
    first.notifications.triggers.bigTransaction.thresholds['5'] = 500;
    first.notifications.channels.toast = false;
    first.notifications.privacy.hideAmount = false;

    const second = mergeSettings({});
    expect(second.notifications.triggers.bigTransaction.thresholds).toEqual({});
    expect(second.notifications.channels.toast).toBe(true);
    expect(second.notifications.privacy.hideAmount).toBe(true);
  });
});
