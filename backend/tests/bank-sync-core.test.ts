import { describe, it, expect } from 'vitest';
import { normalizeEbTransaction, syncWindowStart } from '../src/domain/imports/bank-sync-core.js';
import type { EbTransaction } from '../src/services/enable-banking/client.js';

function tx(overrides: Partial<EbTransaction>): EbTransaction {
  return {
    transaction_amount: { currency: 'EUR', amount: '12.5' },
    credit_debit_indicator: 'DBIT',
    status: 'BOOK',
    booking_date: '2026-07-15',
    ...overrides,
  };
}

describe('normalizeEbTransaction', () => {
  it('drops pending transactions', () => {
    expect(normalizeEbTransaction(tx({ status: 'PEND' }))).toBeNull();
  });

  it('keeps transactions with no status field (defensive: some banks omit it)', () => {
    expect(normalizeEbTransaction(tx({ status: undefined as unknown as string }))).not.toBeNull();
  });

  it('drops rows with no usable date or amount', () => {
    expect(normalizeEbTransaction(tx({ booking_date: null }))).toBeNull();
    expect(
      normalizeEbTransaction(tx({ transaction_amount: { currency: 'EUR', amount: 'abc' } })),
    ).toBeNull();
  });

  it('prefers booking_date, falls back to value_date then transaction_date', () => {
    expect(normalizeEbTransaction(tx({}))!.date).toBe('2026-07-15');
    expect(
      normalizeEbTransaction(tx({ booking_date: null, value_date: '2026-07-16' }))!.date,
    ).toBe('2026-07-16');
    expect(
      normalizeEbTransaction(
        tx({ booking_date: null, value_date: null, transaction_date: '2026-07-17' }),
      )!.date,
    ).toBe('2026-07-17');
  });

  it('truncates date-times to the day', () => {
    expect(normalizeEbTransaction(tx({ booking_date: '2026-07-15T00:00:00Z' }))!.date).toBe('2026-07-15');
  });

  it('applies the ISO 20022 direction: DBIT negative, CRDT positive, two decimals', () => {
    expect(normalizeEbTransaction(tx({ credit_debit_indicator: 'DBIT' }))!.amount).toBe('-12.50');
    expect(normalizeEbTransaction(tx({ credit_debit_indicator: 'CRDT' }))!.amount).toBe('12.50');
  });

  it('never double-negates a bank that sends signed amounts with DBIT', () => {
    const n = normalizeEbTransaction(
      tx({ transaction_amount: { currency: 'EUR', amount: '-25.30' }, credit_debit_indicator: 'DBIT' }),
    );
    expect(n!.amount).toBe('-25.30');
  });

  it('keeps the original sign when the indicator is missing', () => {
    const n = normalizeEbTransaction(
      tx({
        transaction_amount: { currency: 'EUR', amount: '-8.00' },
        credit_debit_indicator: undefined as unknown as string,
      }),
    );
    expect(n!.amount).toBe('-8.00');
  });

  it('builds the label from joined remittance information', () => {
    const n = normalizeEbTransaction(
      tx({ remittance_information: [' CARTE 12/07 ', '', 'CARREFOUR PARIS '] }),
    );
    expect(n!.rawLabel).toBe('CARTE 12/07 CARREFOUR PARIS');
  });

  it('falls back to the counterparty name, then the bank transaction code description', () => {
    expect(
      normalizeEbTransaction(tx({ creditor: { name: 'EDF' } }))!.rawLabel,
    ).toBe('EDF');
    expect(
      normalizeEbTransaction(
        tx({ credit_debit_indicator: 'CRDT', debtor: { name: 'EMPLOYEUR SA' } }),
      )!.rawLabel,
    ).toBe('EMPLOYEUR SA');
    expect(
      normalizeEbTransaction(tx({ bank_transaction_code: { description: 'Virement' } }))!.rawLabel,
    ).toBe('Virement');
    expect(normalizeEbTransaction(tx({}))!.rawLabel).toBe('Transaction');
  });

  it('keeps the counterparty as memo when the label came from remittance', () => {
    const n = normalizeEbTransaction(
      tx({ remittance_information: ['PRLV SEPA'], creditor: { name: 'EDF' } }),
    );
    expect(n!.rawLabel).toBe('PRLV SEPA');
    expect(n!.memo).toBe('EDF');
  });

  it('maps entry_reference to fitid (stable dedup across syncs)', () => {
    expect(normalizeEbTransaction(tx({ entry_reference: 'REF-42' }))!.fitid).toBe('REF-42');
    expect(normalizeEbTransaction(tx({}))!.fitid).toBeNull();
  });
});

describe('syncWindowStart', () => {
  it('is undefined on first sync (full consent history)', () => {
    expect(syncWindowStart(null)).toBeUndefined();
  });

  it('backs off 7 days from the last sync', () => {
    expect(syncWindowStart(new Date('2026-07-30T08:00:00Z'))).toBe('2026-07-23');
  });
});
