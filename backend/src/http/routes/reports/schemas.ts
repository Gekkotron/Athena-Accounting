import { z } from 'zod';

// Comma-separated list of positive ints, e.g. "1,3,7". Empty string is
// rejected so callers don't smuggle an unfiltered request through the
// multi-account path. Duplicates are preserved but the SQL IN clause makes
// them idempotent.
const AccountIdsCsv = z
  .string()
  .regex(/^\d+(,\d+)*$/, 'must be a comma-separated list of positive integers')
  .transform((s) => s.split(',').map((n) => Number(n)))
  .refine((arr) => arr.every((n) => Number.isInteger(n) && n > 0), {
    message: 'each id must be a positive integer',
  });

export const RangeQuery = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  granularity: z.enum(['day', 'month']).default('day'),
  // Optional per-account filter. Applied to the categories report so the
  // Dashboard donut can follow the currently-scoped account. Not applied to
  // the other endpoints in this file — they aggregate across accounts by
  // design.
  accountId: z.coerce.number().int().positive().optional(),
  // Multi-account variant: when present, takes precedence over accountId.
  // Used by the Dashboard's "All available accounts" scope to aggregate over
  // the subset whose lock has elapsed.
  accountIds: AccountIdsCsv.optional(),
});

export const BudgetQuery = z.object({
  period: z.enum(['monthly', 'yearly']).default('monthly'),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'must be YYYY-MM').optional(),
  year: z.string().regex(/^\d{4}$/, 'must be YYYY').optional(),
  accountId: z.coerce.number().int().positive().optional(),
});
