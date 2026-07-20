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

export const CreateBody = z.object({
  name: z.string().trim().min(1).max(128),
  type: z.string().trim().min(1).max(64),
  currency: isoCurrency.default('EUR'),
  openingBalance: decimal.default('0'),
  openingDate: isoDate,
  lockYears: lockYears.optional(),
});

export const UpdateBody = z
  .object({
    name: z.string().trim().min(1).max(128),
    type: z.string().trim().min(1).max(64),
    currency: isoCurrency,
    openingBalance: decimal,
    openingDate: isoDate,
    lockYears: lockYears,
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
