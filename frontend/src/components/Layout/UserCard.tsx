import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { User } from '../../api/types';
import { usePrivacy } from '../../contexts/PrivacyContext';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';

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

export function UserCard({ user, onLogout }: { user: User; onLogout: () => void }) {
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
