import { describe, it, expect } from 'vitest';
import {
  envelopeAssignments,
  envelopeCategorySettings,
  envelopeMonthHolds,
} from '../src/db/schema.js';

describe('envelope schema', () => {
  it('exports envelope_assignments with expected columns', () => {
    const cols = Object.keys(envelopeAssignments);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id', 'userId', 'categoryId', 'month', 'amount', 'currency',
        'createdAt', 'updatedAt',
      ]),
    );
  });

  it('exports envelope_category_settings with target and policy columns', () => {
    const cols = Object.keys(envelopeCategorySettings);
    expect(cols).toEqual(
      expect.arrayContaining([
        'userId', 'categoryId', 'targetAmount', 'targetDate',
        'targetKind', 'overspendPolicy', 'updatedAt',
      ]),
    );
  });

  it('exports envelope_month_holds with month PK', () => {
    const cols = Object.keys(envelopeMonthHolds);
    expect(cols).toEqual(
      expect.arrayContaining(['userId', 'month', 'amount', 'updatedAt']),
    );
  });
});
