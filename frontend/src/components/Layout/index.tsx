import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { User } from '../../api/types';
import { DemoBanner } from '../DemoBanner';
import { DemoUnavailableModal } from '../DemoUnavailableModal';
import { nav } from './nav-config';
import { NavTree } from './NavTree';
import { Brand } from './Brand';
import { UserCard } from './UserCard';
import { SiteFooter } from './SiteFooter';

export function Layout({ user }: { user: User }) {
  const { t } = useTranslation(['layout', 'common']);
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

  return (
    <>
      <DemoBanner />
      <div className="min-h-screen flex flex-col md:flex-row">
        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 border-b border-ink-800/70 bg-ink-950/85 backdrop-blur">
          <Brand />
          <button
            aria-label={t('header.menu', { ns: 'layout' })}
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
          <div
            className="md:hidden fixed inset-0 z-40 bg-ink-950/70 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          >
            <aside
              className="absolute right-0 top-0 h-full w-72 bg-ink-900 border-l border-ink-800 px-5 py-6 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-8">
                <Brand />
                <button
                  aria-label={t('close', { ns: 'common' })}
                  onClick={() => setDrawerOpen(false)}
                  className="btn-ghost !min-h-0 !py-1.5 !px-2"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <nav>
                <NavTree sections={nav} onNavigate={() => setDrawerOpen(false)} />
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
          <nav className="overflow-y-auto flex-1 min-h-0">
            <NavTree sections={nav} />
          </nav>
          <UserCard user={user} onLogout={() => logout.mutate()} />
        </aside>

        {/* Main area */}
        <main className="flex-1 min-w-0 px-4 py-6 md:px-10 md:py-10">
          <div className="max-w-7xl mx-auto">
            <Outlet />
            <SiteFooter />
          </div>
        </main>
      </div>
      <DemoUnavailableModal />
    </>
  );
}
