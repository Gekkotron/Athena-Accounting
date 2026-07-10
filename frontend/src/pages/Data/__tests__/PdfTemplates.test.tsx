import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PdfTemplates } from '../PdfTemplates';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn().mockResolvedValue({ accounts: [] }) };
});

vi.mock('../../../api/pdf-templates', async () => {
  const actual = await vi.importActual<typeof import('../../../api/pdf-templates')>('../../../api/pdf-templates');
  return { ...actual, listPdfTemplates: vi.fn().mockResolvedValue([]) };
});

describe('PdfTemplates route', () => {
  it('renders the PdfTemplatesPanel', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PdfTemplates />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Templates PDF')).toBeInTheDocument();
  });
});
