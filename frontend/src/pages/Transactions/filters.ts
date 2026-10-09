export interface Filters {
  accountId?: number;
  categoryId?: number;
  sourceFileId?: number;
  fromDate?: string;
  toDate?: string;
  search?: string;
  amount?: string;
  type?: 'income' | 'expense' | 'transfer';
  uncategorized?: boolean;
  sort: 'date' | 'amount' | 'label';
  order: 'asc' | 'desc';
}
