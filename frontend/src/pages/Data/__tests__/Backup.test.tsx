import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Backup } from '../Backup';
import { withTips } from '../../../test/renderWithProviders';
import { pinLocale } from '../../../test/i18n';

// BackupPanel (rendered by this route) uses useTranslation('imports').
// Preload the namespace for both locales so it never suspends mid-render,
// then pin the active language to French so the existing French-literal
// assertion below keeps matching real rendered text.
pinLocale('imports', 'tips');

describe('Backup route', () => {
  it('renders the BackupPanel', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        {withTips(<Backup />)}
      </QueryClientProvider>,
    );
    expect(screen.getByText('Sauvegarde complète')).toBeInTheDocument();
  });
});
