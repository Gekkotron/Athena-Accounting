import { describe, expect, it } from 'vitest';
import { normalizeLabel } from '../normalize.js';

describe('normalizeLabel', () => {
  it.each([
    ['', ''],
    ['   ', ''],
    ['CARREFOUR', 'carrefour'],
    ['  Carrefour   Market  ', 'carrefour market'],
    ['Crédit Agricole', 'credit agricole'],
    ['Café Müller', 'cafe muller'.replace(' ', ' ')],
  ])('normalizes %j', (input, expected) => {
    expect(normalizeLabel(input)).toBe(expected);
  });

  it('treats null-ish input as empty', () => {
    expect(normalizeLabel(undefined as unknown as string)).toBe('');
    expect(normalizeLabel(null as unknown as string)).toBe('');
  });

  it('strips payment prefixes', () => {
    expect(normalizeLabel('CB CARREFOUR')).toBe('carrefour');
    expect(normalizeLabel('PAIEMENT CARTE CARREFOUR')).toBe('carrefour');
    expect(normalizeLabel('PRLV EDF')).toBe('edf');
  });

  it('collapses stacked prefixes', () => {
    expect(normalizeLabel('PAIEMENT CB CARREFOUR')).toBe('carrefour');
  });

  it('collapses VIR INST and VIR SEPA to the same key', () => {
    expect(normalizeLabel('VIR INST 12345678 DUPONT')).toBe(normalizeLabel('VIR SEPA 12345678 DUPONT'));
    expect(normalizeLabel('VIR SEPA DUPONT')).toBe('dupont');
  });

  it('strips dates in several formats', () => {
    expect(normalizeLabel('CB CARREFOUR 27/06')).toBe('carrefour');
    expect(normalizeLabel('CB CARREFOUR 27/06/2026')).toBe('carrefour');
    expect(normalizeLabel('CB CARREFOUR 27.06.26')).toBe('carrefour');
    expect(normalizeLabel('CB CARREFOUR 27-06-2026')).toBe('carrefour');
  });

  it('strips long digit runs and orphan 3-5 digit numbers', () => {
    expect(normalizeLabel('CB CARREFOUR 123456789')).toBe('carrefour');
    expect(normalizeLabel('PAIEMENT CARTE CARREFOUR 1234')).toBe('carrefour');
    expect(normalizeLabel('shop 1234 paris')).toBe('shop paris');
  });

  it('makes cluttered variants of the same merchant equal', () => {
    expect(normalizeLabel('CB CARREFOUR 27/06')).toBe(normalizeLabel('PAIEMENT CARTE CARREFOUR 1234'));
  });

  it('is idempotent', () => {
    const once = normalizeLabel('CB Café 27/06/2026 987654321');
    expect(normalizeLabel(once)).toBe(once);
  });
});
