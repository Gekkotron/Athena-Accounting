import { lazy, useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError, setUnauthorizedHandler } from './api/client';
import type { User } from './api/types';
import type { Notification } from '../../shared/api-contracts.js';
import { startNotificationsStream } from './lib/notifications/stream.js';
import { showToast } from './lib/notifications/channels/toast.js';
import { sendWebPush } from './lib/notifications/channels/webPush.js';
import { sendOsNotification } from './lib/notifications/channels/osNative.js';
import { useNotificationPrefs } from './lib/notifications/hooks.js';
import type { NotificationPrefs } from './lib/settings';
import { ToastProvider, useToast } from './components/Toast';
import { LockProvider } from './contexts/LockContext';
import { TipsProvider } from './contexts/TipsContext';
import { TourProvider } from './contexts/TourContext';
import { TourBubble } from './components/TourBubble';
import { LockScreen } from './components/LockScreen';
import { Layout } from './components/Layout';
import { HubLayout, type HubTab } from './components/HubLayout';

// Route-level code splitting (perf audit 2026-09-11). Each page component
// lands in its own Vite chunk, fetched on demand when the route is first
// visited. The Suspense boundary that gates these lazies lives in main.tsx
// (see the <Suspense fallback> wrapping <App />). Layout / providers / the
// auth-gate query itself stay eager so the shell paints without a network
// round-trip.
const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Transactions = lazy(() => import('./pages/Transactions').then((m) => ({ default: m.Transactions })));
const Tri = lazy(() => import('./pages/Rules/Tri').then((m) => ({ default: m.Tri })));
const Categories = lazy(() => import('./pages/Rules/Categories').then((m) => ({ default: m.Categories })));
const Plafonds = lazy(() => import('./pages/Budgets/Plafonds').then((m) => ({ default: m.Plafonds })));
const Enveloppes = lazy(() => import('./pages/Budgets/Enveloppes/Enveloppes').then((m) => ({ default: m.Enveloppes })));
const Rules = lazy(() => import('./pages/Rules').then((m) => ({ default: m.Rules })));
const DetectedTab = lazy(() => import('./pages/Recurrent/DetectedTab').then((m) => ({ default: m.DetectedTab })));
const UpcomingTab = lazy(() => import('./pages/Recurrent/UpcomingTab').then((m) => ({ default: m.UpcomingTab })));
const ForecastTab = lazy(() => import('./pages/Recurrent/ForecastTab').then((m) => ({ default: m.ForecastTab })));
const Accounts = lazy(() => import('./pages/Accounts').then((m) => ({ default: m.Accounts })));
const Goals = lazy(() => import('./pages/Goals').then((m) => ({ default: m.Goals })));
const Imports = lazy(() => import('./pages/Data/Imports').then((m) => ({ default: m.Imports })));
const BankSync = lazy(() => import('./pages/Data/BankSync').then((m) => ({ default: m.BankSync })));
const Duplicates = lazy(() => import('./pages/Data/Duplicates').then((m) => ({ default: m.Duplicates })));
const PdfTemplates = lazy(() => import('./pages/Data/PdfTemplates').then((m) => ({ default: m.PdfTemplates })));
const Backup = lazy(() => import('./pages/Data/Backup').then((m) => ({ default: m.Backup })));
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })));
const SettingsGeneral = lazy(() => import('./pages/Settings/SettingsGeneral').then((m) => ({ default: m.SettingsGeneral })));
const SettingsDashboard = lazy(() => import('./pages/Settings/SettingsDashboard').then((m) => ({ default: m.SettingsDashboard })));
const SettingsTransactions = lazy(() => import('./pages/Settings/SettingsTransactions').then((m) => ({ default: m.SettingsTransactions })));
const SettingsImport = lazy(() => import('./pages/Settings/SettingsImport').then((m) => ({ default: m.SettingsImport })));
const SettingsFx = lazy(() => import('./pages/Settings/SettingsFx').then((m) => ({ default: m.SettingsFx })));
const SettingsSecurityPage = lazy(() => import('./pages/Settings/SettingsSecurityPage').then((m) => ({ default: m.SettingsSecurityPage })));
const SettingsNotifications = lazy(() => import('./pages/Settings/SettingsNotifications').then((m) => ({ default: m.SettingsNotifications })));
const Notifications = lazy(() => import('./pages/Notifications').then((m) => ({ default: m.Notifications })));
const BankSyncCallback = lazy(() => import('./pages/BankSyncCallback').then((m) => ({ default: m.BankSyncCallback })));

// Single fan-out point for live notification channels. Each adapter is a
// no-op unless its runtime is present (toast: always; webPush: the browser
// Notification API + granted permission; osNative: window.__TAURI__), so
// the channel toggles are the only gate — the adapters handle the rest.
function fanoutToChannels(
  n: Notification,
  push: (t: { title: string; body: string }) => void,
  prefs: NotificationPrefs,
): void {
  if (prefs.channels.toast)    showToast(push, n, prefs.privacy);
  if (prefs.channels.webPush)  sendWebPush(n, prefs.privacy);
  if (prefs.channels.osNative) void sendOsNotification(n, prefs.privacy);
}

// Lives inside <ToastProvider> so it can obtain `push` via useToast(); the
// channel adapters themselves stay hook-free (see lib/notifications/channels).
// Mounted only for the authenticated tree, so the SSE connection opens after
// login and its cleanup (es.close()) runs on logout/unmount.
//
// `prefs` is read through a ref instead of being an effect dependency:
// `prefs` comes from the shared ['settings'] query, so ANY patchSettings()
// call anywhere in the app (dashboard range, FX currency, bank-sync hour,
// ...) invalidates and refetches it, producing a new object reference. If
// that reference were in the deps array, every unrelated settings save
// would tear down and reopen the SSE connection — and a plain EventSource
// with no Last-Event-ID silently drops any notification pushed during that
// close/reopen gap. The ref keeps the stream open for the component's full
// lifetime while `onEvent` still always reads the latest prefs.
function NotificationsBridge({ qc }: { qc: QueryClient }): null {
  const { push } = useToast();
  const { prefs } = useNotificationPrefs();
  const prefsRef = useRef(prefs);
  useEffect(() => { prefsRef.current = prefs; }, [prefs]);
  useEffect(() => {
    const stop = startNotificationsStream((n) => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      fanoutToChannels(n, push, prefsRef.current);
    });
    return stop;
  }, [qc, push]);
  return null;
}

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

  const SETTINGS_TABS: HubTab[] = [
    { to: '/settings/general', label: t('nav.children.settings.general') },
    { to: '/settings/dashboard', label: t('nav.children.settings.dashboard') },
    { to: '/settings/transactions', label: t('nav.children.settings.transactions') },
    { to: '/settings/import', label: t('nav.children.settings.import') },
    { to: '/settings/fx', label: t('nav.children.settings.fx') },
    { to: '/settings/security', label: t('nav.children.settings.security') },
    { to: '/settings/notifications', label: t('nav.children.settings.notifications') },
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

  const user = me.data?.user ?? null;

  if (me.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        {t('loading', { ns: 'common' })}
      </div>
    );
  }

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
    <ToastProvider>
      <NotificationsBridge qc={qc} />
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
            </Route>

            {/* Récurrent hub */}
            <Route path="/recurring" element={<HubLayout title={t('nav.items.recurrent')} tabs={RECURRENT_TABS} />}>
              <Route index element={<Navigate to="detected" replace />} />
              <Route path="detected" element={<DetectedTab />} />
              <Route path="upcoming" element={<UpcomingTab />} />
              <Route path="forecast" element={<ForecastTab />} />
            </Route>

            <Route path="/accounts" element={<Accounts />} />
            <Route path="/goals" element={<Goals />} />

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

            {/* Réglages hub */}
            <Route path="/settings" element={<HubLayout title={t('user.settings')} tabs={SETTINGS_TABS} />}>
              <Route index element={<Navigate to="general" replace />} />
              <Route path="general" element={<SettingsGeneral />} />
              <Route path="dashboard" element={<SettingsDashboard />} />
              <Route path="transactions" element={<SettingsTransactions />} />
              <Route path="import" element={<SettingsImport />} />
              <Route path="fx" element={<SettingsFx />} />
              <Route path="security" element={<SettingsSecurityPage />} />
              <Route path="integrations" element={<Navigate to="/settings/security" replace />} />
              <Route path="notifications" element={<SettingsNotifications />} />
            </Route>

            <Route path="/notifications" element={<Notifications />} />
            <Route path="/bank-sync/callback" element={<BankSyncCallback />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
          </Routes>
        </TourProvider>
      </TipsProvider>
      </LockProvider>
    </ToastProvider>
  );
}
