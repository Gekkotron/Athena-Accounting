import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { User } from '../api/types';
import { Logo } from './Logo';
import { navIcons, type NavIconName } from './NavIcons';
import { usePrivacy } from '../contexts/PrivacyContext';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';
import { DemoBanner } from './DemoBanner';
import { DemoUnavailableModal } from './DemoUnavailableModal';

type NavChild = { to: string; labelKey: string; end?: boolean };
type NavItem = {
  to: string;
  labelKey: string;
  end?: boolean;
  icon: NavIconName;
  children?: NavChild[];
};
type NavSection = { titleKey: string; items: NavItem[] };

const nav: NavSection[] = [
  {
    titleKey: 'nav.sections.daily',
    items: [
      { to: '/', labelKey: 'nav.items.dashboard', end: true, icon: 'dashboard' },
      { to: '/transactions', labelKey: 'nav.items.transactions', icon: 'transactions' },
      {
        to: '/budgets',
        labelKey: 'nav.items.budgets',
        icon: 'budgets',
        children: [
          { to: '/budgets/caps', labelKey: 'nav.children.budgets.plafonds' },
          { to: '/budgets/envelopes', labelKey: 'nav.children.budgets.enveloppes' },
        ],
      },
    ],
  },
  {
    titleKey: 'nav.sections.classification',
    items: [
      {
        to: '/rules',
        labelKey: 'nav.items.rules',
        icon: 'rules',
        children: [
          { to: '/rules/sort', labelKey: 'nav.children.rules.sort' },
          { to: '/rules/list', labelKey: 'nav.children.rules.list' },
          { to: '/rules/categories', labelKey: 'nav.children.rules.categories' },
        ],
      },
      {
        to: '/recurring',
        labelKey: 'nav.items.recurrent',
        icon: 'recurrent',
        children: [
          { to: '/recurring/detected', labelKey: 'nav.children.recurrent.detected' },
          { to: '/recurring/upcoming', labelKey: 'nav.children.recurrent.upcoming' },
          { to: '/recurring/forecast', labelKey: 'nav.children.recurrent.forecast' },
        ],
      },
    ],
  },
  {
    titleKey: 'nav.sections.structure',
    items: [
      {
        to: '/accounts',
        labelKey: 'nav.items.accounts',
        end: true,
        icon: 'accounts',
      },
      {
        to: '/data',
        labelKey: 'nav.items.data',
        icon: 'imports',
        children: [
          { to: '/data/imports', labelKey: 'nav.children.data.imports' },
          { to: '/data/duplicates', labelKey: 'nav.children.data.duplicates' },
          { to: '/data/pdf-templates', labelKey: 'nav.children.data.pdfTemplates' },
          { to: '/data/backup', labelKey: 'nav.children.data.backup' },
        ],
      },
    ],
  },
];

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `relative rounded-lg px-3 py-2 text-sm transition flex items-center gap-3 ${
    isActive
      ? 'text-ink-50 bg-ink-850'
      : 'text-ink-400 hover:text-ink-100 hover:bg-ink-900/70'
  }`;

function useNavBadgeCounts(): Record<string, number> {
  // Shares the queryKey with DuplicatesPanel so the two views stay in sync
  // and the badge updates as soon as the user resolves a group.
  const duplicates = useQuery({
    queryKey: ['transaction-duplicates'],
    queryFn: () =>
      api<{ groups: unknown[] }>('/api/transactions/duplicates'),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
  return {
    '/data/duplicates': duplicates.data?.groups?.length ?? 0,
  };
}

function NavTree({
  sections,
  onNavigate,
}: {
  sections: NavSection[];
  onNavigate?: () => void;
}) {
  const { t } = useTranslation('layout');
  const location = useLocation();
  const badges = useNavBadgeCounts();
  return (
    <div className="flex flex-col gap-5">
      {sections.map((section) => (
        <div key={section.titleKey}>
          <div className="label px-2 mb-2">{t(section.titleKey)}</div>
          <div className="flex flex-col gap-1">
            {section.items.map((item) => {
              const Icon = navIcons[item.icon];
              const isHub = !!item.children?.length;
              const isActiveHub =
                isHub &&
                (location.pathname === item.to ||
                  location.pathname.startsWith(item.to + '/'));
              const rootBadge = isHub
                ? item.children!.reduce((sum, c) => sum + (badges[c.to] ?? 0), 0)
                : (badges[item.to] ?? 0);
              return (
                <div key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={navLinkClass}
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={isActive || isActiveHub ? 'text-sage-300' : 'text-ink-500'} />
                        <span>{t(item.labelKey)}</span>
                        {rootBadge > 0 && (
                          <span
                            aria-label={t('nav.badge', { count: rootBadge })}
                            className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-clay-500/25 text-clay-200 text-[10px] font-mono leading-none"
                          >
                            {rootBadge}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                  {isHub && isActiveHub && (
                    <div className="ml-8 mt-1 flex flex-col gap-0.5">
                      {item.children!.map((child) => {
                        const childBadge = badges[child.to] ?? 0;
                        const badge = childBadge > 0 ? childBadge : null;
                        return (
                          <NavLink
                            key={child.to}
                            to={child.to}
                            end={child.end}
                            onClick={onNavigate}
                            className={({ isActive }) =>
                              `flex items-center gap-2 rounded-md px-2 py-1 text-xs transition ${
                                isActive
                                  ? 'text-ink-100 bg-ink-900/60'
                                  : 'text-ink-500 hover:text-ink-200'
                              }`
                            }
                          >
                            <span>{t(child.labelKey)}</span>
                            {badge !== null && (
                              <span
                                aria-label={t('nav.badge', { count: badge })}
                                className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-clay-500/25 text-clay-200 text-[10px] font-mono leading-none"
                              >
                                {badge}
                              </span>
                            )}
                          </NavLink>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

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
        <div className="md:hidden fixed inset-0 z-40 bg-ink-950/70 backdrop-blur-sm" onClick={() => setDrawerOpen(false)}>
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

function SiteFooter() {
  const { t } = useTranslation('layout');
  return (
    <footer className="mt-16 pt-6 border-t border-ink-800/60 flex items-center justify-center gap-1.5 text-xs text-ink-500">
      <span>Athena Accounting</span>
      <span aria-hidden>·</span>
      <a
        href="https://github.com/Gekkotron/Athena-Accounting"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-ink-400 transition hover:text-ink-100 underline-offset-2 hover:underline"
      >
        <GitHubIcon />
        {t('footer.githubLink')}
      </a>
    </footer>
  );
}

function GitHubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
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
  const { t } = useTranslation('layout');
  const privacy = usePrivacy();
  return (
    <div className="mt-auto pt-6 border-t border-ink-800/60">
      <div className="flex items-center justify-between mb-1">
        <div className="label">{t('header.connectedAs')}</div>
        <LanguageSwitcher />
      </div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <NavLink
          to="/profile"
          className={({ isActive }) =>
            `block text-sm truncate font-medium underline-offset-2 hover:underline flex-1 min-w-0 ${
              isActive ? 'text-sage-300' : 'text-ink-100 hover:text-ink-50'
            }`
          }
          title={t('user.editProfile')}
        >
          {user.username}
        </NavLink>
        <NavLink
          to="/settings"
          title={t('user.settings')}
          aria-label={t('user.settings')}
          className={({ isActive }) =>
            `btn-ghost !min-h-0 !py-1 !px-1.5 shrink-0 ${
              isActive ? 'text-sage-300' : 'text-ink-400 hover:text-ink-100'
            }`
          }
        >
          <GearIcon />
        </NavLink>
      </div>
      <button
        className="btn-ghost w-full justify-start text-xs mb-1"
        onClick={privacy.toggle}
        title={privacy.hidden ? t('user.privacy.show') : t('user.privacy.hideTitle')}
      >
        {privacy.hidden ? <EyeOpenIcon /> : <EyeClosedIcon />}
        {privacy.hidden ? t('user.privacy.show') : t('user.privacy.hide')}
      </button>
      <button className="btn-ghost w-full justify-start text-xs" onClick={onLogout}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M5 2H3a1 1 0 00-1 1v8a1 1 0 001 1h2M9 9l3-2-3-2M12 7H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t('user.logout')}
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

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M7 1v1.5M7 11.5V13M13 7h-1.5M2.5 7H1M11.24 2.76l-1.06 1.06M3.82 10.18l-1.06 1.06M11.24 11.24l-1.06-1.06M3.82 3.82L2.76 2.76"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
