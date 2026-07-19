import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import './i18n';
import App from './App';
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

// The demo ships as a plain Vite bundle on GitHub Pages — there is no
// server to fall back to index.html for deep URLs, so refreshing a page
// like /demo/recurrent/prevision returns a hard 404. HashRouter keeps
// the whole route in the URL fragment (/demo/#/recurrent/prevision), so
// the browser always requests /demo/index.html and the SPA takes over
// from there. The real self-hosted app keeps BrowserRouter — its
// backend does the SPA fallback and clean URLs stay clean.
const isDemo = Boolean(import.meta.env.VITE_DEMO);
const Router = isDemo ? HashRouter : BrowserRouter;
const routerProps = isDemo ? {} : { basename: import.meta.env.BASE_URL };

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router {...routerProps}>
        <Suspense fallback={<div />}>
          <App />
        </Suspense>
      </Router>
    </QueryClientProvider>
  </React.StrictMode>,
);
