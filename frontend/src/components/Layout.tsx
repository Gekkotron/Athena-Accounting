import { useState } from 'react';
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
  const [drawerOpen, setDrawerOpen] = useState(false);

  const logout = useMutation({
    mutationFn: () => api<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      qc.clear();
      navigate('/login', { replace: true });
    },
  });

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `relative rounded-lg px-3 py-2 text-sm transition ${
      isActive
        ? 'text-ink-50 bg-ink-850'
        : 'text-ink-400 hover:text-ink-100 hover:bg-ink-900/70'
    }`;

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 border-b border-ink-800/70 bg-ink-950/85 backdrop-blur">
        <Brand />
        <button
          aria-label="Menu"
          onClick={() => setDrawerOpen(true)}
          className="btn-secondary !min-h-0 !py-1.5 !px-2"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-ink-950/70 backdrop-blur-sm" onClick={() => setDrawerOpen(false)}>
          <aside
            className="absolute right-0 top-0 h-full w-72 bg-ink-900 border-l border-ink-800 px-5 py-6 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-8">
              <Brand />
              <button
                aria-label="Fermer"
                onClick={() => setDrawerOpen(false)}
                className="btn-ghost !min-h-0 !py-1.5 !px-2"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <nav className="flex flex-col gap-1">
              {nav.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setDrawerOpen(false)} className={navLinkClass}>
                  {n.label}
                </NavLink>
              ))}
            </nav>
            <UserCard user={user} onLogout={() => logout.mutate()} />
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 border-r border-ink-800/70 bg-ink-950/60 px-4 py-6 flex-col">
        <div className="mb-10 px-2">
          <Brand />
        </div>
        <nav className="flex flex-col gap-1">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={navLinkClass}>
              {({ isActive }) => (
                <span className="flex items-center gap-2">
                  <span
                    className={`h-1 w-1 rounded-full transition ${
                      isActive ? 'bg-sage-300' : 'bg-transparent'
                    }`}
                  />
                  {n.label}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <UserCard user={user} onLogout={() => logout.mutate()} />
      </aside>

      {/* Main area */}
      <main className="flex-1 min-w-0 px-4 py-6 md:px-10 md:py-10">
        <div className="max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-baseline gap-2">
      <span className="display text-[22px] leading-none text-ink-50 tracking-tight">Athena</span>
      <span className="display-italic text-[13px] text-ink-500">ledger</span>
    </div>
  );
}

function UserCard({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <div className="mt-auto pt-6 border-t border-ink-800/60 mt-8">
      <div className="label mb-1">Connecté</div>
      <div className="text-sm text-ink-100 mb-3 truncate font-medium">{user.username}</div>
      <button className="btn-ghost w-full justify-start text-xs" onClick={onLogout}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M5 2H3a1 1 0 00-1 1v8a1 1 0 001 1h2M9 9l3-2-3-2M12 7H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Se déconnecter
      </button>
    </div>
  );
}
