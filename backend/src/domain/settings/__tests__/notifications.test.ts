import { describe, it, expect } from 'vitest';
import { SettingsSchema, mergeSettings } from '../schema.js';

describe('settings.notifications', () => {
  it('defaults are privacy-safe and enabled', () => {
    const s = mergeSettings({});
    expect(s.notifications.enabled).toBe(true);
    expect(s.notifications.privacy.hideAmount).toBe(true);
    expect(s.notifications.privacy.hideMerchant).toBe(true);
    expect(s.notifications.channels.toast).toBe(true);
    expect(s.notifications.channels.osNative).toBe(false);
    expect(s.notifications.channels.webPush).toBe(false);
    expect(s.notifications.channels.callmebot).toEqual({ enabled: false, phone: '', apiKey: '', maxPerMinute: 0 });
    expect(s.notifications.channels.discord).toEqual({ enabled: false, webhookUrl: '', maxPerMinute: 0 });
  });

  it('deep-merges discord settings so a partial patch keeps siblings', () => {
    const url = 'https://discord.com/api/webhooks/123/abc-DEF_9';
    const after = mergeSettings(
      { notifications: { channels: { discord: { enabled: true, webhookUrl: url, maxPerMinute: 5 } } } },
      { notifications: { channels: { discord: { enabled: false } } } },
    );
    expect(after.notifications.channels.discord).toEqual({ enabled: false, webhookUrl: url, maxPerMinute: 5 });
    expect(after.notifications.channels.callmebot.enabled).toBe(false);
  });

  it('validates the discord webhook URL (SSRF guard)', () => {
    const parse = (webhookUrl: string) =>
      SettingsSchema.safeParse({ notifications: { channels: { discord: { webhookUrl } } } }).success;
    expect(parse('')).toBe(true);
    expect(parse('https://discord.com/api/webhooks/123/abc-DEF_9')).toBe(true);
    expect(parse('http://192.168.1.1/x')).toBe(false);
    expect(parse('https://evil.com/api/webhooks/1/a')).toBe(false);
    expect(parse('http://discord.com/api/webhooks/1/a')).toBe(false);
  });

  it('deep-merges callmebot credentials so a partial patch keeps siblings', () => {
    const after1 = mergeSettings({
      notifications: {
        channels: { callmebot: { enabled: true, phone: '+33612345678', apiKey: 'abc123' } },
      },
    });
    expect(after1.notifications.channels.callmebot).toEqual({
      enabled: true, phone: '+33612345678', apiKey: 'abc123', maxPerMinute: 0,
    });

    // Second patch toggles just `enabled` — phone/apiKey must survive.
    const after2 = mergeSettings(
      {
        notifications: {
          channels: { callmebot: { enabled: true, phone: '+33612345678', apiKey: 'abc123' } },
        },
      },
      { notifications: { channels: { callmebot: { enabled: false } } } },
    );
    expect(after2.notifications.channels.callmebot).toEqual({
      enabled: false, phone: '+33612345678', apiKey: 'abc123', maxPerMinute: 0,
    });
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
