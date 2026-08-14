import { describe, it, expect } from 'vitest';
import { CreateBody, PatchBody } from '../fx-rates.js';

describe('fx-rates CreateBody', () => {
  it('accepts a valid payload', () => {
    const result = CreateBody.safeParse({
      from: 'USD', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a lowercase currency code', () => {
    const result = CreateBody.safeParse({
      from: 'usd', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9',
    });
    expect(result.success).toBe(false);
  });

  it('rejects from === to', () => {
    const result = CreateBody.safeParse({
      from: 'EUR', to: 'EUR', effectiveFrom: '2026-01-01', rate: '1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO date', () => {
    const result = CreateBody.safeParse({
      from: 'USD', to: 'EUR', effectiveFrom: '01/01/2026', rate: '0.9',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-numeric rate string', () => {
    const result = CreateBody.safeParse({
      from: 'USD', to: 'EUR', effectiveFrom: '2026-01-01', rate: 'abc',
    });
    expect(result.success).toBe(false);
  });

  it('rejects rate "0" (must be > 0)', () => {
    const result = CreateBody.safeParse({
      from: 'USD', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0',
    });
    expect(result.success).toBe(false);
  });
});

describe('fx-rates PatchBody', () => {
  it('rejects an empty object (nothing to update)', () => {
    const result = PatchBody.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts { rate } alone', () => {
    const result = PatchBody.safeParse({ rate: '0.85' });
    expect(result.success).toBe(true);
  });

  it('accepts { effectiveFrom } alone', () => {
    const result = PatchBody.safeParse({ effectiveFrom: '2026-02-01' });
    expect(result.success).toBe(true);
  });
});
