import type {
  envelopeAssignments,
  envelopeCategorySettings,
  envelopeMonthHolds,
} from '../../../db/schema.js';

export function serializeAssignment(row: typeof envelopeAssignments.$inferSelect) {
  return {
    id: row.id,
    categoryId: row.categoryId,
    month: row.month.slice(0, 7),          // wire form "YYYY-MM" (DB stores first-of-month DATE)
    amount: row.amount,
    currency: row.currency,
  };
}

export function serializeSettings(row: typeof envelopeCategorySettings.$inferSelect) {
  return {
    categoryId: row.categoryId,
    targetAmount: row.targetAmount,
    targetDate: row.targetDate,
    targetKind: row.targetKind,
    overspendPolicy: row.overspendPolicy,
  };
}

export function serializeHold(row: typeof envelopeMonthHolds.$inferSelect) {
  return {
    month: row.month.slice(0, 7),          // wire form "YYYY-MM" (DB stores first-of-month DATE)
    amount: row.amount,
  };
}
