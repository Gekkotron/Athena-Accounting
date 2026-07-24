import { describe, it, expect } from 'vitest';
import { detectPriceCreep } from '../src/services/recurring-creep-core.js';

// Amounts are chronological (oldest → newest), signed as stored: expenses
// negative, income positive. Creep is judged on magnitude.
describe('detectPriceCreep', () => {
  it('returns null below the occurrence floor', () => {
    expect(detectPriceCreep([-80, -80, -95])).toBeNull();
  });

  it('flags a magnitude increase past both thresholds', () => {
    const creep = detectPriceCreep([-80, -80, -80, -95]);
    expect(creep).not.toBeNull();
    expect(creep!.previousAvg).toBeCloseTo(-80);
    expect(creep!.latest).toBe(-95);
    expect(creep!.deltaPct).toBeCloseTo(18.75);
  });

  it('stays quiet at 9.9% even when the absolute delta is large', () => {
    expect(detectPriceCreep([-100, -100, -100, -109.9])).toBeNull();
  });

  it('flags exactly at the 10% boundary', () => {
    const creep = detectPriceCreep([-100, -100, -100, -110]);
    expect(creep).not.toBeNull();
    expect(creep!.deltaPct).toBeCloseTo(10);
  });

  it('stays quiet below the 2-unit absolute floor even at a high percentage', () => {
    expect(detectPriceCreep([-10, -10, -10, -11.5])).toBeNull();
  });

  it('flags magnitude decreases with a negative deltaPct', () => {
    const creep = detectPriceCreep([-100, -100, -100, -85]);
    expect(creep).not.toBeNull();
    expect(creep!.deltaPct).toBeCloseTo(-15);
  });

  it('works on income series with positive amounts', () => {
    const creep = detectPriceCreep([2000, 2000, 2000, 2300]);
    expect(creep).not.toBeNull();
    expect(creep!.deltaPct).toBeCloseTo(15);
  });

  it('returns null for a zero baseline', () => {
    expect(detectPriceCreep([0, 0, 0, 5])).toBeNull();
  });
});
