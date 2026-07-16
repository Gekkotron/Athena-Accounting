import { useTranslation } from 'react-i18next';

const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
] as const;

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = (i18n.language?.startsWith('fr') ? 'fr' : 'en') as 'en' | 'fr';

  return (
    <label className="inline-flex items-center gap-1 text-sm">
      <span aria-hidden="true">🌐</span>
      <select
        value={current}
        onChange={(e) => {
          const next = e.target.value as 'en' | 'fr';
          void i18n.changeLanguage(next);
          try {
            localStorage.setItem('athena.lang', next);
          } catch {
            // storage may be blocked in private mode; the change still applies
            // to this session.
          }
        }}
        className="bg-transparent focus:outline-none"
        aria-label="Language"
      >
        {LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
