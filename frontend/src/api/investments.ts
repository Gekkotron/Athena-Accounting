import { api } from './client';
import type { InvestmentsTimeseries } from '../../../shared/api-contracts';

export type { InvestmentsTimeseries };

export interface InvestmentsTimeseriesParams {
  fromDate?: string;
  granularity: 'day' | 'month';
  accountId?: number;
  display?: string | null;
}

export function getInvestmentsTimeseries(p: InvestmentsTimeseriesParams) {
  return api<InvestmentsTimeseries>('/api/reports/investments-timeseries', {
    query: {
      granularity: p.granularity,
      ...(p.fromDate ? { fromDate: p.fromDate } : {}),
      ...(p.accountId !== undefined ? { accountId: p.accountId } : {}),
      ...(p.display ? { display: p.display } : {}),
    },
  });
}
