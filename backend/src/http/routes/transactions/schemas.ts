import { z } from 'zod';

export const ListQuery = z.object({
  accountId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  // Filter to transactions inserted from a specific file_import row. Powers
  // the "list transactions from this PDF import" affordance in the Imports
  // page's post-import banner.
  sourceFileId: z.coerce.number().int().positive().optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  minAmount: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional(),
  maxAmount: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional(),
  // Match exact amount, sign-agnostic — a search for "338" hits both -338 and
  // +338 transactions. The frontend auto-detects numeric input and routes here
  // instead of the text search.
  amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional(),
  search: z.string().trim().max(128).optional(),
  includeTransfers: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .default(false),
  sort: z.enum(['date', 'amount', 'label']).default('date'),
  order: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// All fields optional — the PATCH applies whichever ones are present, so the
// frontend can update any subset without sending the others.
export const PatchBody = z.object({
  accountId: z.number().int().positive().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional(),
  rawLabel: z.string().trim().min(1).max(512).optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  // Per-transaction lock override in years. Null clears the override
  // (falls back to the account's default lock).
  lockYears: z.number().int().min(0).max(99).nullable().optional(),
});

// Body for manual creation. raw_label is required; the server derives the
// normalized_label + dedup_key. categoryId is optional — when omitted the rule
// engine fires the same way it does at import time.
export const CreateBody = z.object({
  accountId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
  rawLabel: z.string().trim().min(1).max(512),
  categoryId: z.number().int().positive().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lockYears: z.number().int().min(0).max(99).nullable().optional(),
});

export const IdParam = z.object({ id: z.coerce.number().int().positive() });
