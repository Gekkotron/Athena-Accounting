import type { LoanListItem } from '../../api/loans';

export type LoansTab = 'loans' | 'simulations';

// Loans of one tab, repaid ones last, creation order otherwise.
export function sortLoans(all: LoanListItem[], tab: LoansTab): LoanListItem[] {
  const repaid = (l: LoanListItem) => (l.summary?.today.status === 'repaid' ? 1 : 0);
  return all
    .filter((l) => l.isSimulation === (tab === 'simulations'))
    .sort((a, b) => repaid(a) - repaid(b) || a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
}
