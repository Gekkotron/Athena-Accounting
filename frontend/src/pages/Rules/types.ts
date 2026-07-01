import type { Category, Rule } from '../../api/types';

export interface GroupedEntry {
  category: Category;
  rules: Rule[];
}
