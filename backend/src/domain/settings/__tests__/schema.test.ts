import { describe, it, expect } from 'vitest';
import { SettingsSchema, mergeSettings } from '../schema.js';

describe('settings — displayCurrency', () => {
  it('accepts a 3-letter uppercase code', () => {
    const parsed = SettingsSchema.safeParse({ displayCurrency: 'EUR' });
    expect(parsed.success).toBe(true);
  });

  it('accepts null (per-currency mode)', () => {
    const parsed = SettingsSchema.safeParse({ displayCurrency: null });
    expect(parsed.success).toBe(true);
  });

  it('rejects lowercase and non-3-letter codes', () => {
    expect(SettingsSchema.safeParse({ displayCurrency: 'eur' }).success).toBe(false);
    expect(SettingsSchema.safeParse({ displayCurrency: 'EU' }).success).toBe(false);
    expect(SettingsSchema.safeParse({ displayCurrency: 'EUROS' }).success).toBe(false);
  });

  it('defaults to null when absent from stored JSONB', () => {
    const merged = mergeSettings({});
    expect(merged.displayCurrency).toBeNull();
  });
});
