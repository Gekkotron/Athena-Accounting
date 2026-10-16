import type { Loan } from '../../../../shared/api-contracts';

const STAMP = '2026-01-01T09:00:00.000Z';

// Demo loans, frozen against SEED_TODAY (2026-07-18): a mortgage that
// started with a construction-phase partial deferral, a 0 % consumer loan,
// and a what-if derived from the mortgage.
export function buildSeedLoans(): Loan[] {
  const mortgage: Loan = {
    id: 1,
    name: 'Résidence principale',
    kind: 'mortgage',
    isSimulation: false,
    sourceLoanId: null,
    currency: 'EUR',
    principal: '245000.00',
    startDate: '2023-09-10',
    annualRate: '3.85',
    insuranceRate: '0.34',
    insuranceBasis: 'initial',
    fees: '1850.00',
    periods: [{ kind: 'partial_deferral', months: 12 }],
    finalPeriod: { solve: 'payment', endDate: '2048-08' },
    earlyRepayments: [],
    createdAt: STAMP,
    updatedAt: STAMP,
  };
  return [
    mortgage,
    {
      ...mortgage,
      id: 2,
      name: 'Crédit conso 0 %',
      kind: 'consumer',
      principal: '4800.00',
      startDate: '2025-11-05',
      annualRate: '0',
      insuranceRate: '0',
      fees: '0.00',
      periods: [],
      finalPeriod: { solve: 'payment', endDate: '2027-10' },
    },
    {
      ...mortgage,
      id: 3,
      name: 'Résidence — remboursement 20 k€',
      isSimulation: true,
      sourceLoanId: 1,
      earlyRepayments: [{ date: '2027-01', amount: '20000', effect: 'shorten', penalty: '600' }],
    },
  ];
}
