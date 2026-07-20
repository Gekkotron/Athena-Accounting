import { z } from 'zod';

export const RangeQuery = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  granularity: z.enum(['day', 'month']).default('day'),
  // Optional per-account filter. Applied to the categories report so the
  // Dashboard donut can follow the currently-scoped account. Not applied to
  // the other endpoints in this file — they aggregate across accounts by
  // design.
  accountId: z.coerce.number().int().positive().optional(),
});

export const BudgetQuery = z.object({
  period: z.enum(['monthly', 'yearly']).default('monthly'),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'must be YYYY-MM').optional(),
  year: z.string().regex(/^\d{4}$/, 'must be YYYY').optional(),
  accountId: z.coerce.number().int().positive().optional(),
});
