import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from './api/client';
import type { User } from './api/types';
import { Layout } from './components/Layout';
import { HubLayout, type HubTab } from './components/HubLayout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Transactions } from './pages/Transactions';
import { Tri } from './pages/Rules/Tri';
import { Categories } from './pages/Rules/Categories';
import { Budgets } from './pages/Budgets';
import { Rules } from './pages/Rules';
import { Accounts } from './pages/Accounts';
import { Patterns } from './pages/Accounts/Patterns';
import { Imports } from './pages/Data/Imports';
import { Duplicates } from './pages/Data/Duplicates';
import { PdfTemplates } from './pages/Data/PdfTemplates';
import { Backup } from './pages/Data/Backup';
import { Profile } from './pages/Profile';
import { Settings } from './pages/Settings';

const RULES_TABS: HubTab[] = [
  { to: '/regles/tri', label: 'Tri' },
  { to: '/regles/liste', label: 'Règles' },
  { to: '/regles/categories', label: 'Catégories' },
];

const COMPTES_TABS: HubTab[] = [
  { to: '/comptes', label: 'Comptes', end: true },
  { to: '/comptes/motifs', label: 'Motifs de fichier' },
];

const DONNEES_TABS: HubTab[] = [
  { to: '/donnees/imports', label: 'Imports' },
  { to: '/donnees/doublons', label: 'Doublons' },
  { to: '/donnees/modeles', label: 'Modèles PDF' },
  { to: '/donnees/sauvegarde', label: 'Sauvegarde' },
];

export default function App() {
  const location = useLocation();

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
        Chargement…
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
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Layout user={user} />}>
        <Route index element={<Dashboard />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/budgets" element={<Budgets />} />

        {/* Règles hub */}
        <Route path="/regles" element={<HubLayout title="Règles" tabs={RULES_TABS} />}>
          <Route index element={<Navigate to="tri" replace />} />
          <Route path="tri" element={<Tri />} />
          <Route path="liste" element={<Rules />} />
          <Route path="categories" element={<Categories />} />
        </Route>

        {/* Comptes hub */}
        <Route path="/comptes" element={<HubLayout title="Comptes" tabs={COMPTES_TABS} />}>
          <Route index element={<Accounts />} />
          <Route path="motifs" element={<Patterns />} />
        </Route>

        {/* Données hub */}
        <Route path="/donnees" element={<HubLayout title="Données" tabs={DONNEES_TABS} />}>
          <Route index element={<Navigate to="imports" replace />} />
          <Route path="imports" element={<Imports />} />
          <Route path="doublons" element={<Duplicates />} />
          <Route path="modeles" element={<PdfTemplates />} />
          <Route path="sauvegarde" element={<Backup />} />
        </Route>

        <Route path="/profil" element={<Profile />} />
        <Route path="/reglages" element={<Settings />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
