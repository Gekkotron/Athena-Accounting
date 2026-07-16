import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const NAMESPACES = [
  'common',
  'layout',
  'dashboard',
  'transactions',
  'imports',
  'rules',
  'accounts',
  'budgets',
  'settings',
  'pdf-template',
  'charts',
  'tips',
] as const;

type Ns = (typeof NAMESPACES)[number];

async function loadNamespace(lang: 'en' | 'fr', ns: Ns) {
  return (await import(`../locales/${lang}/${ns}.json`)).default;
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'fr'],
    ns: ['common'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'athena.lang',
      caches: ['localStorage'],
    },
    resources: {},
    partialBundledLanguages: true,
  })
  .then(async () => {
    // Load the currently active language's common bundle immediately so the
    // first paint has strings; other namespaces lazy-load per useTranslation.
    const current = (i18n.language.startsWith('fr') ? 'fr' : 'en') as 'en' | 'fr';
    const common = await loadNamespace(current, 'common');
    i18n.addResourceBundle(current, 'common', common, true, true);
  });

// Register a backend that fetches namespace bundles on demand.
i18n.services.backendConnector.backend = {
  type: 'backend',
  init: () => {},
  read: async (lng: string, ns: string, callback: (err: unknown, data?: unknown) => void) => {
    try {
      const lang = (lng.startsWith('fr') ? 'fr' : 'en') as 'en' | 'fr';
      const bundle = await loadNamespace(lang, ns as Ns);
      callback(null, bundle);
    } catch (err) {
      callback(err);
    }
  },
} as unknown as typeof i18n.services.backendConnector.backend;

export default i18n;
export type { Ns };
