import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';

describe('i18n smoke', () => {
  beforeAll(async () => {
    // ensure both language bundles are available before running
    await i18n.loadLanguages(['en', 'fr']);
    await i18n.loadNamespaces(['common']);
  });

  it('renders LanguageSwitcher in French by default', async () => {
    await i18n.changeLanguage('fr');
    render(
      <I18nextProvider i18n={i18n}>
        <LanguageSwitcher />
      </I18nextProvider>,
    );
    expect(screen.getByRole('combobox', { name: /language/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Français' })).toBeInTheDocument();
  });

  it('can switch to English and back to French', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('save', { ns: 'common' })).toBe('Save');
    await i18n.changeLanguage('fr');
    expect(i18n.t('save', { ns: 'common' })).toBe('Enregistrer');
  });
});
