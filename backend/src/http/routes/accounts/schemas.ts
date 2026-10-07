import { z } from 'zod';

export const decimal = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'must be a decimal with up to 2 fraction digits');

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be ISO date YYYY-MM-DD');

export const isoCurrency = z
  .string()
  .regex(/^[A-Z]{3}$/, 'must be ISO 4217 3-letter code');

// lockYears: 0..99. null means "no lock" — never blocked. 0 is *not* the same
// as null (0 = unlocked immediately on opening; null = no lock rule at all).
export const lockYears = z.number().int().min(0).max(99).nullable();

// IBAN input: accept either null or any string with spaces/case variations;
// normalize to compact uppercase. An empty string after normalization maps
// to null (matches the "no IBAN set" state). Validation is deliberately
// shallow — country + check digits + 11..30 alphanumerics — no MOD-97
// checksum because real-world IBANs from Enable Banking occasionally fail
// strict checksum (e.g. masked or truncated formats) and we don't want to
// refuse a value the bank itself returned.
export const ibanField = z
  .union([z.string(), z.null()])
  .transform((v, ctx) => {
    if (v == null) return null;
    const compact = v.replace(/\s+/g, '').toUpperCase();
    if (compact === '') return null;
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be a valid IBAN' });
      return z.NEVER;
    }
    return compact;
  });

export const CreateBody = z.object({
  name: z.string().trim().min(1).max(128),
  type: z.string().trim().min(1).max(64),
  currency: isoCurrency.default('EUR'),
  openingBalance: decimal.default('0'),
  openingDate: isoDate,
  lockYears: lockYears.optional(),
  closedAt: isoDate.nullable().optional(),
  iban: ibanField.optional(),
});

export const UpdateBody = z
  .object({
    name: z.string().trim().min(1).max(128),
    type: z.string().trim().min(1).max(64),
    currency: isoCurrency,
    openingBalance: decimal,
    openingDate: isoDate,
    lockYears: lockYears,
    closedAt: isoDate.nullable(),
    iban: ibanField,
  })
  .partial();

export const IdParam = z.object({ id: z.coerce.number().int().positive() });

export const MergeBody = z.object({
  targetId: z.number().int().positive(),
});

export const ReorderBody = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(200),
});

export const SourceIdParam = z.object({ sourceId: z.coerce.number().int().positive() });
