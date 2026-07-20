import { describe, expect, it } from 'vitest';
import type { envelopeAssignments, envelopeCategorySettings, envelopeMonthHolds } from '../src/db/schema.js';
import {
  serializeAssignment,
  serializeHold,
  serializeSettings,
} from '../src/http/routes/envelopes/serializers.js';

type AssignmentRow = typeof envelopeAssignments.$inferSelect;
type SettingsRow  = typeof envelopeCategorySettings.$inferSelect;
type HoldRow      = typeof envelopeMonthHolds.$inferSelect;

const isoDate = (s: string) => s; // DB stores as string in this project

describe('serializeAssignment', () => {
  it('slices first-of-month DATE into wire YYYY-MM', () => {
    const row: AssignmentRow = {
      id: 42,
      userId: 1,
      categoryId: 7,
      month: isoDate('2026-07-01'),
      amount: '150.00',
      currency: 'EUR',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(serializeAssignment(row)).toEqual({
      id: 42,
      categoryId: 7,
      month: '2026-07',
      amount: '150.00',
      currency: 'EUR',
    });
  });

  it('never returns the raw first-of-month DATE (guards against slice(0,10) regression)', () => {
    const row: AssignmentRow = {
      id: 1, userId: 1, categoryId: 1,
      month: '2026-12-01', amount: '10.00', currency: 'EUR',
      createdAt: new Date(), updatedAt: new Date(),
    };
    expect(serializeAssignment(row).month).toBe('2026-12');
    expect(serializeAssignment(row).month).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('serializeSettings', () => {
  it('passes target/policy fields through', () => {
    const row: SettingsRow = {
      userId: 1,
      categoryId: 3,
      targetAmount: '400.00',
      targetDate: '2027-01-01',
      targetKind: 'save_by_date',
      overspendPolicy: 'rollover_negative',
      updatedAt: new Date(),
    };
    expect(serializeSettings(row)).toEqual({
      categoryId: 3,
      targetAmount: '400.00',
      targetDate: '2027-01-01',
      targetKind: 'save_by_date',
      overspendPolicy: 'rollover_negative',
    });
  });

  it('preserves nulls on optional targets', () => {
    const row: SettingsRow = {
      userId: 1, categoryId: 3,
      targetAmount: null, targetDate: null, targetKind: null,
      overspendPolicy: 'reallocate_manual',
      updatedAt: new Date(),
    };
    const s = serializeSettings(row);
    expect(s.targetAmount).toBeNull();
    expect(s.targetDate).toBeNull();
    expect(s.targetKind).toBeNull();
  });
});

describe('serializeHold', () => {
  it('slices first-of-month DATE into wire YYYY-MM', () => {
    const row: HoldRow = {
      userId: 1,
      month: '2026-07-01', amount: '25.00',
      updatedAt: new Date(),
    };
    expect(serializeHold(row)).toEqual({ month: '2026-07', amount: '25.00' });
  });
});
