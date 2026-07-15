export interface Filters {
  accountId?: number;
  categoryId?: number;
  sourceFileId?: number;
  fromDate?: string;
  toDate?: string;
  search?: string;
  amount?: string;
  sort: 'date' | 'amount' | 'label';
  order: 'asc' | 'desc';
}
