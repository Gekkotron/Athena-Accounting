import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { navIcons } from '../NavIcons';
import { navLinkClass, type NavSection } from './nav-config';

function useNavBadgeCounts(): Record<string, number> {
  // Shares the queryKey with DuplicatesPanel so the two views stay in sync
  // and the badge updates as soon as the user resolves a group.
  const duplicates = useQuery({
    queryKey: ['transaction-duplicates'],
    queryFn: () => api<{ groups: unknown[] }>('/api/transactions/duplicates'),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
  return {
    '/data/duplicates': duplicates.data?.groups?.length ?? 0,
  };
}

export function NavTree({
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
