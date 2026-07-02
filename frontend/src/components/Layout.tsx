import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { User } from '../api/types';
import { Logo } from './Logo';
import { navIcons, type NavIconName } from './NavIcons';
import { usePrivacy } from '../contexts/PrivacyContext';

const nav: { to: string; label: string; end?: boolean; icon: NavIconName }[] = [
  { to: '/', label: 'Dashboard', end: true, icon: 'dashboard' },
  { to: '/transactions', label: 'Transactions', icon: 'transactions' },
  { to: '/tri', label: 'Tri', icon: 'tri' },
  { to: '/categories', label: 'Catégories', icon: 'categories' },
  { to: '/rules', label: 'Règles', icon: 'rules' },
  { to: '/accounts', label: 'Comptes', icon: 'accounts' },
  { to: '/imports', label: 'Imports / Sauvegarde', icon: 'imports' },
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
    `relative rounded-lg px-3 py-2 text-sm transition flex items-center gap-3 ${
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
              {nav.map((n) => {
                const Icon = navIcons[n.icon];
                return (
                  <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setDrawerOpen(false)} className={navLinkClass}>
                    {({ isActive }) => (
                      <>
                        <Icon className={isActive ? 'text-sage-300' : 'text-ink-500'} />
                        <span>{n.label}</span>
                      </>
                    )}
                  </NavLink>
                );
              })}
            </nav>
            <UserCard user={user} onLogout={() => logout.mutate()} />
          </aside>
        </div>
      )}

      {/* Desktop sidebar — sticky to the viewport so the nav + the user card
          stay in place while the main content scrolls. self-start so the
          sidebar doesn't stretch to match the (potentially very tall)
          transactions/reports page height. */}
      <aside className="hidden md:flex w-60 shrink-0 border-r border-ink-800/70 bg-ink-950/60 px-4 py-6 flex-col sticky top-0 self-start h-screen">
        <div className="mb-10 px-2">
          <Brand />
        </div>
        <nav className="flex flex-col gap-1 overflow-y-auto flex-1 min-h-0">
          {nav.map((n) => {
            const Icon = navIcons[n.icon];
            return (
              <NavLink key={n.to} to={n.to} end={n.end} className={navLinkClass}>
                {({ isActive }) => (
                  <>
                    <Icon className={isActive ? 'text-sage-300' : 'text-ink-500'} />
                    <span>{n.label}</span>
                  </>
                )}
              </NavLink>
            );
          })}
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
    <div className="flex items-center gap-2.5">
      <Logo size={28} className="text-sage-300 shrink-0" />
      <div className="flex flex-col leading-none">
        <span className="display text-[20px] text-ink-50 tracking-tight">Athena</span>
        <span className="display-italic text-[12px] text-ink-500 mt-0.5">Accounting</span>
      </div>
    </div>
  );
}

function UserCard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const privacy = usePrivacy();
  return (
    <div className="mt-auto pt-6 border-t border-ink-800/60">
      <div className="label mb-1">Connecté</div>
      <NavLink
        to="/profile"
        className={({ isActive }) =>
          `block text-sm mb-3 truncate font-medium underline-offset-2 hover:underline ${
            isActive ? 'text-sage-300' : 'text-ink-100 hover:text-ink-50'
          }`
        }
        title="Modifier mon profil"
      >
        {user.username}
      </NavLink>
      <button
        className="btn-ghost w-full justify-start text-xs mb-1"
        onClick={privacy.toggle}
        title={privacy.hidden ? 'Afficher les montants' : 'Masquer les montants (auto après 5 min)'}
      >
        {privacy.hidden ? <EyeOpenIcon /> : <EyeClosedIcon />}
        {privacy.hidden ? 'Afficher les montants' : 'Masquer les montants'}
      </button>
      <button className="btn-ghost w-full justify-start text-xs" onClick={onLogout}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M5 2H3a1 1 0 00-1 1v8a1 1 0 001 1h2M9 9l3-2-3-2M12 7H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Se déconnecter
      </button>
    </div>
  );
}

function EyeOpenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M1.5 7C2.7 4.5 4.7 3 7 3s4.3 1.5 5.5 4c-1.2 2.5-3.2 4-5.5 4S2.7 9.5 1.5 7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" />
    </svg>
  );
}

function EyeClosedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M1.5 7C2.7 4.5 4.7 3 7 3s4.3 1.5 5.5 4c-1.2 2.5-3.2 4-5.5 4S2.7 9.5 1.5 7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M1.5 1.5l11 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
