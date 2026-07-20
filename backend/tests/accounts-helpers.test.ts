import { describe, it, expect } from 'vitest';
import { isPgError } from '../src/http/routes/accounts/helpers.js';
import {
  CreateBody,
  UpdateBody,
  IdParam,
  MergeBody,
  ReorderBody,
  decimal,
  isoDate,
  isoCurrency,
  lockYears,
} from '../src/http/routes/accounts/schemas.js';

describe('isPgError', () => {
  it('accepts objects with a string `code` property', () => {
    expect(isPgError({ code: '23505' })).toBe(true);
    expect(isPgError({ code: '23505', detail: 'irrelevant' })).toBe(true);
  });

  it('rejects null, non-objects, or objects with a non-string code', () => {
    expect(isPgError(null)).toBe(false);
    expect(isPgError(undefined)).toBe(false);
    expect(isPgError('23505')).toBe(false);
    expect(isPgError(new Error('boom'))).toBe(false);
    expect(isPgError({})).toBe(false);
    expect(isPgError({ code: 23505 })).toBe(false);
  });
});

describe('decimal schema', () => {
  it('accepts integers, one-decimal, and two-decimal values, signed or unsigned', () => {
    for (const v of ['0', '10', '-5', '3.1', '-0.05', '99999.99']) {
      expect(decimal.safeParse(v).success).toBe(true);
    }
  });

  it('rejects malformed inputs', () => {
    for (const v of ['', '.5', '1.', '1.234', 'abc', '5,00']) {
      expect(decimal.safeParse(v).success).toBe(false);
    }
  });
});

describe('isoDate schema', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(isoDate.safeParse('2026-07-20').success).toBe(true);
  });

  it('rejects everything else', () => {
    for (const v of ['2026-7-20', '20-07-2026', '2026/07/20', '2026-07-20T00:00:00', '', 'today']) {
      expect(isoDate.safeParse(v).success).toBe(false);
    }
  });
});

describe('isoCurrency schema', () => {
  it('accepts 3 uppercase letters and rejects everything else', () => {
    expect(isoCurrency.safeParse('EUR').success).toBe(true);
    expect(isoCurrency.safeParse('usd').success).toBe(false);
    expect(isoCurrency.safeParse('EU').success).toBe(false);
    expect(isoCurrency.safeParse('EURO').success).toBe(false);
  });
});

describe('lockYears schema', () => {
  it('accepts null and integers in [0, 99]', () => {
    expect(lockYears.safeParse(null).success).toBe(true);
    expect(lockYears.safeParse(0).success).toBe(true);
    expect(lockYears.safeParse(99).success).toBe(true);
  });

  it('rejects negatives, above-99, and non-integers', () => {
    expect(lockYears.safeParse(-1).success).toBe(false);
    expect(lockYears.safeParse(100).success).toBe(false);
    expect(lockYears.safeParse(1.5).success).toBe(false);
  });
});

describe('CreateBody schema', () => {
  it('applies EUR + 0.00 defaults when currency/openingBalance are omitted', () => {
    const parsed = CreateBody.safeParse({ name: 'Compte', type: 'checking', openingDate: '2026-07-01' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.currency).toBe('EUR');
      expect(parsed.data.openingBalance).toBe('0');
    }
  });

  it('rejects an empty name after trim', () => {
    const parsed = CreateBody.safeParse({ name: '   ', type: 'checking', openingDate: '2026-07-01' });
    expect(parsed.success).toBe(false);
  });

  it('trims a leading/trailing whitespace name', () => {
    const parsed = CreateBody.safeParse({ name: '  BNP  ', type: 'checking', openingDate: '2026-07-01' });
    if (parsed.success) expect(parsed.data.name).toBe('BNP');
  });
});

describe('UpdateBody schema', () => {
  it('allows omitting every field (all partial)', () => {
    expect(UpdateBody.safeParse({}).success).toBe(true);
  });

  it('validates fields when present', () => {
    expect(UpdateBody.safeParse({ currency: 'euro' }).success).toBe(false);
    expect(UpdateBody.safeParse({ openingBalance: '1.234' }).success).toBe(false);
    expect(UpdateBody.safeParse({ name: 'OK' }).success).toBe(true);
  });
});

describe('IdParam schema', () => {
  it('coerces a numeric string path param to a positive int', () => {
    const r = IdParam.safeParse({ id: '42' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.id).toBe(42);
  });

  it('rejects zero, negative, or non-numeric', () => {
    expect(IdParam.safeParse({ id: '0' }).success).toBe(false);
    expect(IdParam.safeParse({ id: '-1' }).success).toBe(false);
    expect(IdParam.safeParse({ id: 'abc' }).success).toBe(false);
  });
});

describe('MergeBody schema', () => {
  it('requires a positive-integer targetId', () => {
    expect(MergeBody.safeParse({ targetId: 3 }).success).toBe(true);
    expect(MergeBody.safeParse({ targetId: 0 }).success).toBe(false);
    expect(MergeBody.safeParse({ targetId: -1 }).success).toBe(false);
    expect(MergeBody.safeParse({}).success).toBe(false);
  });
});

describe('ReorderBody schema', () => {
  it('requires at least one id and caps at 200', () => {
    expect(ReorderBody.safeParse({ ids: [1] }).success).toBe(true);
    expect(ReorderBody.safeParse({ ids: [] }).success).toBe(false);
    const huge = Array.from({ length: 201 }, (_, i) => i + 1);
    expect(ReorderBody.safeParse({ ids: huge }).success).toBe(false);
  });
});
