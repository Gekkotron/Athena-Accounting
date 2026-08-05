import { describe, it, expect } from 'vitest';
import { mergeSettings, SettingsSchema } from '../src/domain/settings/schema.js';

describe('settings.backupHour', () => {
  it('defaults to 3', () => {
    expect(mergeSettings({}).backupHour).toBe(3);
  });
  it('accepts a stored value 0-23', () => {
    expect(mergeSettings({ backupHour: 22 }).backupHour).toBe(22);
  });
  it('rejects out-of-range patches at the schema layer', () => {
    expect(SettingsSchema.safeParse({ backupHour: 24 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ backupHour: -1 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ backupHour: 3 }).success).toBe(true);
  });
  it('a garbage stored blob falls back to the default', () => {
    expect(mergeSettings({ backupHour: 'noon' }).backupHour).toBe(3);
  });
});
