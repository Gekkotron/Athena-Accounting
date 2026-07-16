import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import './i18n';
import App from './App';
import { PrivacyProvider } from './contexts/PrivacyContext';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <PrivacyProvider>
          <Suspense fallback={<div />}>
            <App />
          </Suspense>
        </PrivacyProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
