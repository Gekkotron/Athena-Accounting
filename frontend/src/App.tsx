import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError, setUnauthorizedHandler } from './api/client';
import type { User } from './api/types';
import { LockProvider } from './contexts/LockContext';
import { TipsProvider } from './contexts/TipsContext';
import { TourProvider } from './contexts/TourContext';
import { TourBubble } from './components/TourBubble';
import { LockScreen } from './components/LockScreen';
import { Layout } from './components/Layout';
import { HubLayout, type HubTab } from './components/HubLayout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Transactions } from './pages/Transactions';
import { Tri } from './pages/Rules/Tri';
import { Categories } from './pages/Rules/Categories';
import { Plafonds } from './pages/Budgets/Plafonds';
import { Enveloppes } from './pages/Budgets/Enveloppes/Enveloppes';
import { Rules } from './pages/Rules';
import { Transfers } from './pages/Rules/Transfers';
import { DetectedTab } from './pages/Recurrent/DetectedTab';
import { UpcomingTab } from './pages/Recurrent/UpcomingTab';
import { ForecastTab } from './pages/Recurrent/ForecastTab';
import { Accounts } from './pages/Accounts';
import { Imports } from './pages/Data/Imports';
import { BankSync } from './pages/Data/BankSync';
import { Duplicates } from './pages/Data/Duplicates';
import { PdfTemplates } from './pages/Data/PdfTemplates';
import { Backup } from './pages/Data/Backup';
import { Profile } from './pages/Profile';
import { Settings } from './pages/Settings';
import { BankSyncCallback } from './pages/BankSyncCallback';

export default function App() {
  const location = useLocation();
  const qc = useQueryClient();
  const { t } = useTranslation(['layout', 'common']);

  // Hub-tab labels reuse the same 'layout' namespace keys the sidebar nav
  // (Layout.tsx) already uses for these same routes, so both stay in sync
  // under a language switch. Computed per-render (not hoisted to module
  // scope) since they now depend on `t`.
  const RULES_TABS: HubTab[] = [
    { to: '/rules/sort', label: t('nav.children.rules.sort') },
    { to: '/rules/list', label: t('nav.children.rules.list') },
    { to: '/rules/categories', label: t('nav.children.rules.categories') },
    { to: '/rules/transfers', label: t('nav.children.rules.transfers') },
  ];

  const RECURRENT_TABS: HubTab[] = [
    { to: '/recurring/detected', label: t('nav.children.recurrent.detected') },
    { to: '/recurring/upcoming', label: t('nav.children.recurrent.upcoming') },
    { to: '/recurring/forecast', label: t('nav.children.recurrent.forecast') },
  ];

  const DONNEES_TABS: HubTab[] = [
    { to: '/data/imports', label: t('nav.children.data.imports') },
    { to: '/data/bank-sync', label: t('nav.children.data.bankSync') },
    { to: '/data/duplicates', label: t('nav.children.data.duplicates') },
    { to: '/data/pdf-templates', label: t('nav.children.data.pdfTemplates') },
    { to: '/data/backup', label: t('nav.children.data.backup') },
  ];

  // Global session-expiry redirect: any 401 from a non-auth-me endpoint
  // sets me to a null user, which triggers the redirect to /login on the
  // next render (same path as an explicit logout). Order matters —
  // qc.clear() destroys THIS component's ['me'] observer's Query instance,
  // so a follow-up setQueryData would land on a fresh query the observer
  // no longer sees; we set ['me'] first, then wipe every OTHER key.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(['me'], { user: null });
      qc.removeQueries({ predicate: (q) => !(Array.isArray(q.queryKey) && q.queryKey[0] === 'me') });
    });
    return () => setUnauthorizedHandler(null);
  }, [qc]);

  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api<{ user: User }>('/api/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return { user: null };
        throw err;
      }
    },
  });

  if (me.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        {t('loading', { ns: 'common' })}
      </div>
    );
  }

  const user = me.data?.user ?? null;

  if (!user) {
    if (location.pathname !== '/login') {
      return <Navigate to="/login" replace />;
    }
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <LockProvider>
      <TipsProvider>
        <TourProvider>
          <TourBubble />
          <LockScreen username={user.username} />
          <Routes>
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route element={<Layout user={user} />}>
            <Route index element={<Dashboard />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/budgets" element={<Navigate to="/budgets/caps" replace />} />
            <Route path="/budgets/caps" element={<Plafonds />} />
            <Route path="/budgets/envelopes" element={<Enveloppes />} />

            {/* Règles hub */}
            <Route path="/rules" element={<HubLayout title={t('nav.items.rules')} tabs={RULES_TABS} />}>
              <Route index element={<Navigate to="sort" replace />} />
              <Route path="sort" element={<Tri />} />
              <Route path="list" element={<Rules />} />
              <Route path="categories" element={<Categories />} />
              <Route path="transfers" element={<Transfers />} />
            </Route>

            {/* Récurrent hub */}
            <Route path="/recurring" element={<HubLayout title={t('nav.items.recurrent')} tabs={RECURRENT_TABS} />}>
              <Route index element={<Navigate to="detected" replace />} />
              <Route path="detected" element={<DetectedTab />} />
              <Route path="upcoming" element={<UpcomingTab />} />
              <Route path="forecast" element={<ForecastTab />} />
            </Route>

            <Route path="/accounts" element={<Accounts />} />

            {/* Données hub */}
            <Route path="/data" element={<HubLayout title={t('nav.items.data')} tabs={DONNEES_TABS} />}>
              <Route index element={<Navigate to="imports" replace />} />
              <Route path="imports" element={<Imports />} />
              <Route path="bank-sync" element={<BankSync />} />
              <Route path="duplicates" element={<Duplicates />} />
              <Route path="pdf-templates" element={<PdfTemplates />} />
              <Route path="backup" element={<Backup />} />
            </Route>

            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/bank-sync/callback" element={<BankSyncCallback />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
          </Routes>
        </TourProvider>
      </TipsProvider>
    </LockProvider>
  );
}
