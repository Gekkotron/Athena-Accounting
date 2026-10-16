import { z } from 'zod';
import { LOAN_KINDS } from '../../../domain/loans/record.js';

const money = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'must be a decimal with up to 2 fraction digits');

const positiveMoney = money.refine((v) => Number(v) > 0, 'must be strictly positive');

const rate = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'must be a percentage with up to 4 fraction digits')
  .refine((v) => Number(v) <= 100, 'must be at most 100');

const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be YYYY-MM');

const isoDate = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'must be ISO date YYYY-MM-DD');

const FixedPeriod = z
  .object({
    kind: z.enum(['payment', 'partial_deferral', 'total_deferral']),
    months: z.number().int().min(1).max(600),
    amount: positiveMoney.optional(),
    rate: rate.nullable().optional(),
  })
  .strict()
  .refine((p) => p.kind !== 'payment' || p.amount !== undefined, {
    message: 'amount is required for a payment period',
    path: ['amount'],
  });

const FinalPeriod = z.discriminatedUnion('solve', [
  z.object({ solve: z.literal('payment'), endDate: yearMonth, rate: rate.nullable().optional() }).strict(),
  z.object({ solve: z.literal('end_date'), amount: positiveMoney, rate: rate.nullable().optional() }).strict(),
]);

const EarlyRepayment = z
  .object({
    date: yearMonth,
    amount: positiveMoney,
    effect: z.enum(['reduce_payment', 'shorten']),
    penalty: money.optional(),
  })
  .strict();

// Engine inputs only — the body of POST /api/loans/simulate.
export const LoanTermsBody = z.object({
  principal: positiveMoney,
  startDate: isoDate,
  annualRate: rate,
  insuranceRate: rate.default('0'),
  insuranceBasis: z.enum(['initial', 'remaining']).default('initial'),
  fees: money.default('0'),
  periods: z.array(FixedPeriod).max(50).default([]),
  finalPeriod: FinalPeriod,
  earlyRepayments: z.array(EarlyRepayment).max(50).default([]),
});

// Full loan — the body of POST /api/loans and PUT /api/loans/:id.
export const LoanBody = LoanTermsBody.extend({
  name: z.string().trim().min(1).max(128),
  kind: z.enum(LOAN_KINDS).default('other'),
  isSimulation: z.boolean().default(false),
  sourceLoanId: z.number().int().positive().nullable().default(null),
  currency: z.string().regex(/^[A-Z]{3}$/, 'must be an ISO currency code').default('EUR'),
});

export type LoanBodyT = z.infer<typeof LoanBody>;

export const AsOfQuery = z.object({ asOf: isoDate.optional() });
