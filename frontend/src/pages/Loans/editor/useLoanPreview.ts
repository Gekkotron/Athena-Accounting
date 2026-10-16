import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { loanIssues, simulateLoan, type LoanIssue, type LoanTermsInput } from '../../../api/loans';

// Debounced live preview through POST /api/loans/simulate. `terms` null
// (form not parseable yet) keeps the last result on screen.
export function useLoanPreview(terms: LoanTermsInput | null, delayMs = 250) {
  const key = terms ? JSON.stringify(terms) : null;
  const [debounced, setDebounced] = useState(key);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(key), delayMs);
    return () => clearTimeout(h);
  }, [key, delayMs]);
  const q = useQuery({
    queryKey: ['loans', 'simulate', debounced],
    queryFn: () => simulateLoan(JSON.parse(debounced!) as LoanTermsInput),
    enabled: debounced !== null,
    retry: false,
    placeholderData: (prev) => prev,
  });
  const issues: LoanIssue[] = q.isError ? (loanIssues(q.error) ?? []) : [];
  return {
    data: q.isError ? undefined : q.data,
    issues,
    pending: key !== debounced || q.isFetching,
    failed: q.isError && loanIssues(q.error) === null,
  };
}
