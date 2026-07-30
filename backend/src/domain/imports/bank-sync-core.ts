import type { ParsedTransaction } from './ofx-parser.js';
import type { EbTransaction } from '../../services/enable-banking/client.js';

// Pure normalization from the Enable Banking transaction shape to the row
// shape the OFX parser produces, so bank-sync batches flow through the exact
// same runImport pipeline (dedup, rules, transfer + recurring detection).
// No DB imports here — unit-testable without a driver.

// Overlap re-fetched on every sync. The dedup key absorbs the duplicate rows;
// the overlap exists so a transaction booked late (weekend, card settlement)
// after the previous sync's cutoff is never missed.
const OVERLAP_DAYS = 7;

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const v of values) {
    const t = v?.trim();
    if (t) return t;
  }
  return null;
}

// Returns null for rows Athena must not import (pending, unusable date or
// amount) — callers filter those out.
export function normalizeEbTransaction(t: EbTransaction): ParsedTransaction | null {
  // Only booked transactions land in the ledger; PEND rows change amount,
  // date, or vanish entirely before booking.
  if (t.status && t.status !== 'BOOK') return null;

  const date = firstNonEmpty(t.booking_date, t.value_date, t.transaction_date);
  if (!date) return null;

  const rawAmount = Number(t.transaction_amount?.amount);
  if (!Number.isFinite(rawAmount)) return null;

  // ISO 20022 semantics: the indicator carries the direction. Some banks send
  // the amount already signed as well, so apply the sign to the magnitude
  // rather than multiplying (a signed DBIT amount must not flip positive).
  const magnitude = Math.abs(rawAmount);
  let signed: number;
  if (t.credit_debit_indicator === 'DBIT') signed = -magnitude;
  else if (t.credit_debit_indicator === 'CRDT') signed = magnitude;
  else signed = rawAmount;

  const remittance = (t.remittance_information ?? [])
    .map((s) => s?.trim())
    .filter((s): s is string => !!s)
    .join(' ');
  // The counterparty is whoever is on the other side of the movement.
  const counterparty = firstNonEmpty(
    t.credit_debit_indicator === 'CRDT' ? t.debtor?.name : t.creditor?.name,
    t.creditor?.name,
    t.debtor?.name,
  );
  const rawLabel =
    firstNonEmpty(remittance, counterparty, t.bank_transaction_code?.description) ?? 'Transaction';

  return {
    date: date.slice(0, 10),
    amount: signed.toFixed(2),
    rawLabel,
    memo: counterparty && counterparty !== rawLabel ? counterparty : null,
    fitid: firstNonEmpty(t.entry_reference),
  };
}

// date_from for an account's next fetch: last sync minus the overlap window,
// or undefined on first sync (full history the consent allows).
export function syncWindowStart(lastSyncedAt: Date | null): string | undefined {
  if (!lastSyncedAt) return undefined;
  const from = new Date(lastSyncedAt.getTime() - OVERLAP_DAYS * 86_400_000);
  return from.toISOString().slice(0, 10);
}

// date_from for an account's FIRST sync. Dedup keys cannot match across
// sources (the bank's API references differ from file FITIDs/labels for the
// same money), so re-fetching history that file imports already covered
// creates real duplicates. Start the day after the newest existing
// transaction; full history only when the account is empty.
export function firstSyncStart(latestTxDate: string | null): string | undefined {
  if (!latestTxDate) return undefined;
  const next = new Date(`${latestTxDate.slice(0, 10)}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}
