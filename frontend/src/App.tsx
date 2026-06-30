import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from './api/client';
import type { User } from './api/types';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Transactions } from './pages/Transactions';
import { Tri } from './pages/Tri';
import { Categories } from './pages/Categories';
import { Rules } from './pages/Rules';
import { Accounts } from './pages/Accounts';
import { Imports } from './pages/Imports';
import { Profile } from './pages/Profile';

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
        <Route path="/tri" element={<Tri />} />
        <Route path="/categories" element={<Categories />} />
        <Route path="/rules" element={<Rules />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/imports" element={<Imports />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
