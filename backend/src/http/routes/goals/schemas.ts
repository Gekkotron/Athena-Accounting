import { z } from 'zod';

const decimal = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'must be a decimal with up to 2 fraction digits');

const positiveDecimal = decimal.refine(
  (v) => Number(v) > 0,
  'must be strictly positive',
);

const nonZeroDecimal = decimal.refine(
  (v) => Number(v) !== 0,
  'must be non-zero',
);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be ISO date YYYY-MM-DD');

const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{3,8}$/, 'must be a hex color like #RRGGBB or #RRGGBBAA');

export const CreateGoalBody = z.object({
  accountId: z.number().int().positive(),
  name: z.string().trim().min(1).max(128),
  targetAmount: positiveDecimal,
  targetDate: isoDate.nullable().optional(),
  color: color.nullable().optional(),
});

export const UpdateGoalBody = z
  .object({
    name: z.string().trim().min(1).max(128),
    targetAmount: positiveDecimal,
    targetDate: isoDate.nullable(),
    color: color.nullable(),
  })
  .partial();

export const CreateEventBody = z.object({
  amount: nonZeroDecimal,
  eventDate: isoDate,
  note: z.string().max(500).nullable().optional(),
});

export const UpdateEventBody = z
  .object({
    amount: nonZeroDecimal,
    eventDate: isoDate,
    note: z.string().max(500).nullable(),
  })
  .partial();

export const ListQuery = z.object({
  includeClosed: z
    .union([z.literal('0'), z.literal('1'), z.literal('true'), z.literal('false')])
    .optional(),
});

export const EventsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z.coerce.number().int().positive().optional(),
});
