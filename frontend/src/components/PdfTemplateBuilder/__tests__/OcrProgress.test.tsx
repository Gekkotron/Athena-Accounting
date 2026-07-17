import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OcrProgress } from '../OcrProgress';
import * as api from '../../../api/pdf-templates';
import i18n from '../../../i18n';

function withProviders(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: 100 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// OcrProgress renders French strings by default (the app's current UI
// language). Preload the 'pdf-template' namespace for both locales so
// `useTranslation` never suspends mid-render, then pin the active language
// to French so the existing French-literal assertions below keep matching
// real rendered text.
beforeAll(async () => {
  await i18n.changeLanguage('fr');
  await i18n.loadNamespaces(['pdf-template', 'common']);
});

beforeEach(() => vi.restoreAllMocks());

describe('OcrProgress', () => {
  it('renders a progress bar and calls onReady when status turns ready', async () => {
    let call = 0;
    vi.spyOn(api, 'getOcrStatus').mockImplementation(async () => {
      call++;
      if (call < 3) return { status: 'pending', progress: call, total: 3 };
      return { status: 'ready', progress: 3, total: 3, meanConfidence: 0.9 };
    });
    const onReady = vi.fn();
    const onError = vi.fn();
    render(withProviders(<OcrProgress draftId={42} onReady={onReady} onError={onError} />));
    expect(screen.getByText(/reconnaissance/i)).toBeInTheDocument();
    // Two real 1s poll intervals must elapse before the mock flips to
    // 'ready' (call 3) — that lands at ~2000ms on the nose, so a 2000ms
    // bound is flush against render/promise overhead and flakes. Give it
    // real headroom instead of shrinking the component's poll interval.
    await waitFor(() => expect(onReady).toHaveBeenCalled(), { timeout: 3000 });
    expect(onError).not.toHaveBeenCalled();
  });

  it('calls onError when status turns error', async () => {
    vi.spyOn(api, 'getOcrStatus').mockResolvedValue({
      status: 'error', progress: 0, total: 1, error: 'tesseract crashed',
    });
    const onReady = vi.fn();
    const onError = vi.fn();
    render(withProviders(<OcrProgress draftId={42} onReady={onReady} onError={onError} />));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('tesseract crashed'));
    expect(onReady).not.toHaveBeenCalled();
  });
});
