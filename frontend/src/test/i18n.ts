import { beforeAll, beforeEach } from 'vitest';
import i18n from '../i18n';

/**
 * Register vitest hooks that preload the given namespaces in both
 * languages, then re-pin the render language to French before each
 * test in the calling suite. Call at the top of a describe(...) or
 * once at module scope — the hooks register with the current suite.
 *
 * @param namespaces - i18next namespaces the tests will exercise.
 *                     'common' does not need to be listed explicitly;
 *                     it is always included.
 */
export function pinLocale(...namespaces: string[]): void {
  const nsToLoad = Array.from(new Set(['common', ...namespaces]));
  beforeAll(async () => {
    await i18n.loadLanguages(['en', 'fr']);
    await i18n.loadNamespaces(nsToLoad);
  });
  beforeEach(async () => {
    await i18n.changeLanguage('fr');
  });
}
