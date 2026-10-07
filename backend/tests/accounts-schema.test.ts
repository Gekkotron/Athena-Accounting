import { describe, it, expect } from 'vitest';
import { ibanField, CreateBody, UpdateBody } from '../src/http/routes/accounts/schemas.js';

// Canonical 27-char French IBAN used across these tests. Grouped (as a user
// might paste from a statement) vs compact uppercase (what the DB stores).
const FR_IBAN_GROUPED = 'fr76 1234 5678 9012 3456 7890 123';
const FR_IBAN_COMPACT = 'FR7612345678901234567890123';

describe('accounts schemas — ibanField', () => {
  it('null stays null', () => {
    expect(ibanField.parse(null)).toBeNull();
  });

  it('empty / whitespace-only strings normalize to null', () => {
    expect(ibanField.parse('')).toBeNull();
    expect(ibanField.parse('   ')).toBeNull();
  });

  it('strips spaces and uppercases a valid IBAN', () => {
    expect(ibanField.parse(FR_IBAN_GROUPED)).toBe(FR_IBAN_COMPACT);
  });

  it('rejects a value shorter than 15 characters after normalization', () => {
    expect(() => ibanField.parse('FR7612345')).toThrow();
  });

  it('rejects a value whose first two chars are not letters', () => {
    expect(() => ibanField.parse('1R76 1234 5678 9012 3456 7890 123')).toThrow();
  });

  it('rejects a value with special characters', () => {
    expect(() => ibanField.parse('FR76-1234-5678-9012-3456-7890-123')).toThrow();
  });

  it('CreateBody accepts a payload with iban missing (field is optional)', () => {
    const parsed = CreateBody.parse({ name: 'A', type: 'checking', openingDate: '2026-01-01' });
    expect(parsed.iban).toBeUndefined();
  });

  it('CreateBody normalizes an IBAN passed as mixed case with spaces', () => {
    const parsed = CreateBody.parse({
      name: 'A', type: 'checking', openingDate: '2026-01-01',
      iban: FR_IBAN_GROUPED,
    });
    expect(parsed.iban).toBe(FR_IBAN_COMPACT);
  });

  it('UpdateBody allows clearing the IBAN with null', () => {
    const parsed = UpdateBody.parse({ iban: null });
    expect(parsed.iban).toBeNull();
  });
});
