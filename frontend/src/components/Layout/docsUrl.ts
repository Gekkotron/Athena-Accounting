const DOCS_BASE = 'https://gekkotron.github.io/Athena-Accounting/docs/users/';

const ROUTE_SLUGS: readonly (readonly [string, string])[] = [
  ['/transactions', 'walkthroughs/categorise-transactions'],
  ['/budgets', 'walkthroughs/set-a-budget'],
  ['/rules', 'categorization'],
  ['/recurring', 'categorization'],
  ['/accounts', 'accounts-and-data'],
  ['/data/backup', 'backup-recovery'],
  ['/data/imports', 'importing'],
  ['/data/duplicates', 'importing'],
  ['/data/pdf-templates', 'importing'],
  ['/data', 'accounts-and-data'],
];

export function docsSlugFor(pathname: string): string {
  if (pathname === '/' || pathname === '') return 'dashboard';
  const hit = ROUTE_SLUGS.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + '/'));
  return hit ? hit[1] : 'getting-started';
}

export function docsUrlFor(pathname: string): string {
  return DOCS_BASE + docsSlugFor(pathname);
}
