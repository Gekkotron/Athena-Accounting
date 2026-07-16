import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Backup } from '../Backup';
import { withTips } from '../../../test/renderWithProviders';

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
