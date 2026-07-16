import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PdfTemplates } from '../PdfTemplates';
import i18n from '../../../i18n';

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
beforeAll(async () => {
  await i18n.changeLanguage('fr');
  await i18n.loadNamespaces(['imports', 'common']);
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
