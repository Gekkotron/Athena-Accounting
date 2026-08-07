import { describe, it, expect } from 'vitest';
import { docsSlugFor, docsUrlFor } from '../docsUrl';

describe('docsSlugFor', () => {
  it.each([
    ['/', 'dashboard'],
    ['', 'dashboard'],
    ['/transactions', 'walkthroughs/categorise-transactions'],
    ['/transactions/42', 'walkthroughs/categorise-transactions'],
    ['/budgets', 'walkthroughs/set-a-budget'],
    ['/budgets/caps', 'walkthroughs/set-a-budget'],
    ['/budgets/envelopes', 'walkthroughs/set-a-budget'],
    ['/rules', 'categorization'],
    ['/rules/list', 'categorization'],
    ['/rules/sort', 'categorization'],
    ['/rules/categories', 'categorization'],
    ['/recurring/upcoming', 'categorization'],
    ['/accounts', 'accounts-and-data'],
    ['/data', 'accounts-and-data'],
    ['/data/backup', 'backup-recovery'],
    ['/data/imports', 'importing'],
    ['/data/duplicates', 'importing'],
    ['/data/pdf-templates', 'importing'],
    ['/some/unknown/route', 'getting-started'],
  ])('%s → %s', (pathname, slug) => {
    expect(docsSlugFor(pathname)).toBe(slug);
  });

  it('does not confuse /data-something with /data', () => {
    // Prefix match must respect the segment boundary.
    expect(docsSlugFor('/data-export')).toBe('getting-started');
  });
});

describe('docsUrlFor', () => {
  it('prepends the users-docs base URL', () => {
    expect(docsUrlFor('/rules/list')).toBe(
      'https://gekkotron.github.io/Athena-Accounting/docs/users/categorization',
    );
  });
});
