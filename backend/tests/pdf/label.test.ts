import { describe, it, expect } from 'vitest';
import {
  isBalanceLine,
  isFooterLine,
  mergeContinuationLabel,
  truncateLabel,
} from '../../src/domain/imports/pdf/label.js';

describe('isBalanceLine', () => {
  it('matches "Solde", "Nouveau solde", "Ancien solde", "Total solde"', () => {
    expect(isBalanceLine('Solde créditeur au 01/07/2025')).toBe(true);
    expect(isBalanceLine('Nouveau solde')).toBe(true);
    expect(isBalanceLine('Ancien solde')).toBe(true);
    expect(isBalanceLine('Total solde')).toBe(true);
  });
  it('is case-insensitive and tolerates leading whitespace', () => {
    expect(isBalanceLine('   NOUVEAU SOLDE ')).toBe(true);
    expect(isBalanceLine('solde intermédiaire')).toBe(true);
  });
  it('rejects normal transaction labels', () => {
    expect(isBalanceLine('PRLV SEPA BOUYGUES TELECOM')).toBe(false);
    expect(isBalanceLine('MAGASIN U')).toBe(false);
    expect(isBalanceLine('')).toBe(false);
  });
});

describe('isFooterLine', () => {
  it('matches the classic French bank footer disclaimers', () => {
    // The regression report: the last transaction on the page ended up with
    // "Sous réserve des extournes ou an" as its label.
    expect(isFooterLine('Sous réserve des extournes ou annulation')).toBe(true);
    expect(isFooterLine("Sous réserve d'encaissement")).toBe(true);
    expect(isFooterLine('Sous réserve de bonne fin')).toBe(true);
    expect(isFooterLine('Sauf erreur ou omission')).toBe(true);
    expect(isFooterLine('À reporter')).toBe(true);
    expect(isFooterLine('A reporter')).toBe(true);
  });
  it('is case-insensitive and tolerates leading whitespace', () => {
    expect(isFooterLine('   SOUS RÉSERVE  DES EXTOURNES')).toBe(true);
    expect(isFooterLine('sauf ERREUR ou omission')).toBe(true);
  });
  it('does not match ordinary transaction labels', () => {
    expect(isFooterLine('PRLV SEPA BOUYGUES TELECOM')).toBe(false);
    expect(isFooterLine('MAGASIN U')).toBe(false);
    expect(isFooterLine('CARTE 4964')).toBe(false);
    expect(isFooterLine('')).toBe(false);
  });
});

describe('truncateLabel', () => {
  it('caps at 32 chars by default (matches OFX NAME cap)', () => {
    const long = 'CASTORAMA CARTE 7883 PAIEMENT MOB 0107 KINGERSH 1478/';
    expect(truncateLabel(long)).toHaveLength(32);
    expect(truncateLabel(long)).toBe('CASTORAMA CARTE 7883 PAIEMENT MO');
  });
  it('leaves short labels untouched', () => {
    expect(truncateLabel('MAGASIN U')).toBe('MAGASIN U');
  });
});

describe('mergeContinuationLabel', () => {
  it('appends the continuation when the parent is already the merchant', () => {
    expect(mergeContinuationLabel('MAGASIN U', 'CARTE 4964')).toBe('MAGASIN U CARTE 4964');
  });
  it('promotes the continuation when the parent starts with a bank prefix', () => {
    // "PAIEMENT CB …" → the merchant lives on the continuation line.
    expect(mergeContinuationLabel('PAIEMENT CB 0107', 'CASTORAMA')).toBe('CASTORAMA PAIEMENT CB 0107');
    expect(mergeContinuationLabel('VIREMENT', 'EDF ENERGIES')).toBe('EDF ENERGIES VIREMENT');
    expect(mergeContinuationLabel('PRLV SEPA', 'BOUYGUES TELECOM')).toBe('BOUYGUES TELECOM PRLV SEPA');
  });
  it('respects the OFX 32-char cap', () => {
    const merged = mergeContinuationLabel('PAIEMENT CB CARTE', 'CASTORAMA MEGA STORE PARIS');
    expect(merged.length).toBeLessThanOrEqual(32);
  });
  it('handles empty inputs gracefully', () => {
    expect(mergeContinuationLabel('', 'FOO')).toBe('FOO');
    expect(mergeContinuationLabel('FOO', '')).toBe('FOO');
  });
});
