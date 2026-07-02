import { describe, it, expect } from 'vitest';
import { normalizeLabel } from '../../src/domain/imports/normalize.js';
import { computeDedupKey } from '../../src/domain/imports/dedup.js';

describe('normalizeLabel', () => {
  it('returns empty string on empty/undefined input', () => {
    expect(normalizeLabel('')).toBe('');
  });

  it('lowercases and strips diacritics so "Crédit" == "credit"', () => {
    expect(normalizeLabel('Crédit')).toBe('credit');
    expect(normalizeLabel('CAFÉ NOIR')).toBe('cafe noir');
  });

  it('strips leading payment-method prefixes (CB, VIR, PRLV, RETRAIT DAB…)', () => {
    expect(normalizeLabel('CB CARREFOUR')).toBe('carrefour');
    expect(normalizeLabel('VIREMENT ALAN')).toBe('alan');
    expect(normalizeLabel('PRLV SEPA EDF')).toBe('sepa edf');
    expect(normalizeLabel('RETRAIT DAB MULHOUSE')).toBe('mulhouse');
    expect(normalizeLabel('CHEQUE 1234567')).toBe('');
  });

  it('collapses VIR INST and VIR SEPA to the same shape so the two dedup', () => {
    // Both should normalize to the same value once the "vir <modifier>"
    // prefix is dropped.
    expect(normalizeLabel('VIR INST ALAN')).toBe(normalizeLabel('VIR SEPA ALAN'));
    expect(normalizeLabel('VIR INSTANTANE ALAN')).toBe(normalizeLabel('ALAN'));
  });

  it('strips leading PAIEMENT CB CARREFOUR stack (loop up to 3 prefixes)', () => {
    expect(normalizeLabel('PAIEMENT CB CARREFOUR')).toBe('carrefour');
  });

  it('strips embedded dates and long numeric runs', () => {
    expect(normalizeLabel('CB CARREFOUR 27/06/2025')).toBe('carrefour');
    // Non-leading "CARTE" survives (prefix regex only strips at start).
    // Long digit run is stripped.
    expect(normalizeLabel('MAGASIN U CARTE 6015123456')).toBe('magasin u carte');
  });

  it('strips orphan 3-5 digit reference codes', () => {
    // Space-surrounded 3-5 digit block gets stripped.
    expect(normalizeLabel('carrefour 12345 mulhouse')).toBe('carrefour mulhouse');
  });

  it('collapses whitespace and trims', () => {
    expect(normalizeLabel('   MAGASIN    U   ')).toBe('magasin u');
  });
});

describe('computeDedupKey', () => {
  const base = { accountId: 3, date: '2026-06-15', amount: '-42.30', normalizedLabel: 'carrefour' };

  it('prefixes fitid: when the bank provides a FITID', () => {
    expect(computeDedupKey({ ...base, fitid: '20250615-000123' })).toBe('fitid:20250615-000123');
  });

  it('trims the FITID before using it', () => {
    expect(computeDedupKey({ ...base, fitid: '  20250615-000123  ' })).toBe('fitid:20250615-000123');
  });

  it('falls back to a stable SHA-1 hash when FITID is missing or blank', () => {
    const k1 = computeDedupKey({ ...base });
    const k2 = computeDedupKey({ ...base, fitid: '   ' });
    const k3 = computeDedupKey({ ...base, fitid: null });
    expect(k1).toMatch(/^hash:[0-9a-f]{40}$/);
    expect(k1).toBe(k2);
    expect(k1).toBe(k3);
  });

  it('changes the hash when any material field changes', () => {
    const k0 = computeDedupKey(base);
    const kAccount = computeDedupKey({ ...base, accountId: 4 });
    const kDate = computeDedupKey({ ...base, date: '2026-06-16' });
    const kAmount = computeDedupKey({ ...base, amount: '-42.31' });
    const kLabel = computeDedupKey({ ...base, normalizedLabel: 'monoprix' });
    expect(new Set([k0, kAccount, kDate, kAmount, kLabel]).size).toBe(5);
  });
});
