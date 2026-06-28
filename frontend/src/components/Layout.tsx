import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { User } from '../api/types';

const nav = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/transactions', label: 'Transactions' },
  { to: '/tri', label: 'Tri' },
  { to: '/categories', label: 'Catégories' },
  { to: '/rules', label: 'Règles' },
  { to: '/accounts', label: 'Comptes' },
  { to: '/imports', label: 'Imports' },
];

export function Layout({ user }: { user: User }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      qc.clear();
      navigate('/login', { replace: true });
    },
  });

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 shrink-0 border-r border-slate-900 bg-slate-950/80 px-4 py-6 flex flex-col">
        <div className="mb-8">
          <div className="text-base font-semibold tracking-tight text-slate-100">Athena</div>
          <div className="text-xs text-slate-500">comptabilité personnelle</div>
        </div>
        <nav className="flex flex-col gap-1">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm transition ${
                  isActive
                    ? 'bg-slate-900 text-slate-100'
                    : 'text-slate-400 hover:bg-slate-900/60 hover:text-slate-200'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto pt-6">
          <div className="text-xs text-slate-500 mb-2">Connecté</div>
          <div className="text-sm text-slate-200 mb-3 truncate">{user.username}</div>
          <button className="btn-ghost w-full justify-start text-xs" onClick={() => logout.mutate()}>
            Se déconnecter
          </button>
        </div>
      </aside>
      <main className="flex-1 px-8 py-8 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}
