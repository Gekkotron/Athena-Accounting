// Demo-only translation of the seeded (French) category names into the
// active UI language. The seed stays in French so IDs, rule matching, and
// stored state remain stable; only the `name` surfaced to the frontend
// through the demo API gets rewritten. Non-mapped names (and any language
// other than 'en') fall through unchanged.

import i18n from 'i18next';

const EN_BY_FR: Record<string, string> = {
  Courses: 'Groceries',
  Restaurant: 'Restaurant',
  Transport: 'Transport',
  Logement: 'Housing',
  'Énergie': 'Utilities',
  Loisirs: 'Leisure',
  'Santé': 'Health',
  Salaire: 'Salary',
  'Impôts': 'Taxes',
  Assurance: 'Insurance',
  Abonnements: 'Subscriptions',
};

export function localizeCategoryName(name: string | null | undefined): string | null | undefined {
  if (name == null) return name;
  const lang = i18n.language?.split('-')[0];
  if (lang === 'en') return EN_BY_FR[name] ?? name;
  return name;
}
