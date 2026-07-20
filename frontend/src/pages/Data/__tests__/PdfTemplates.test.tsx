import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PdfTemplates } from '../PdfTemplates';
import { withTips } from '../../../test/renderWithProviders';
import { pinLocale } from '../../../test/i18n';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn().mockResolvedValue({ accounts: [] }) };
});

vi.mock('../../../api/pdf-templates', async () => {
  const actual = await vi.importActual<typeof import('../../../api/pdf-templates')>('../../../api/pdf-templates');
  return { ...actual, listPdfTemplates: vi.fn().mockResolvedValue([]) };
});

// PdfTemplatesPanel (rendered by this route) uses useTranslation for the
// 'imports'/'common' namespaces. Preload them for both locales so it never
// suspends mid-render, then pin the active language to French so the
// existing French-literal assertion below keeps matching real rendered
// text.
pinLocale('imports', 'tips');

describe('PdfTemplates route', () => {
  it('renders the PdfTemplatesPanel', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>{withTips(<PdfTemplates />)}</MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Templates PDF')).toBeInTheDocument();
  });
});
