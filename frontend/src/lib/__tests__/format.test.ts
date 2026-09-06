import { describe, it, expect, afterEach } from 'vitest';
import i18n from '../../i18n';
import { parseDecimal, parseUserDate, formatDate } from '../format';

describe('parseDecimal', () => {
  it('accepts the French decimal comma', () => {
    expect(parseDecimal('1,50')).toBe('1.50');
    expect(parseDecimal('-25,30')).toBe('-25.30');
  });

  it('accepts the English decimal period', () => {
    expect(parseDecimal('1.50')).toBe('1.50');
    expect(parseDecimal('-25.30')).toBe('-25.30');
  });

  it('accepts integers', () => {
    expect(parseDecimal('338')).toBe('338');
    expect(parseDecimal('-1')).toBe('-1');
    expect(parseDecimal('0')).toBe('0');
  });

  it('strips euro sign and interior whitespace', () => {
    expect(parseDecimal('338,50 €')).toBe('338.50');
    expect(parseDecimal('1 338,50 €')).toBe('1338.50');
    expect(parseDecimal(' 42 ')).toBe('42');
  });

  it('rejects empty and whitespace-only input', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('   ')).toBeNull();
  });

  it('rejects non-numeric text', () => {
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('1,50 foo')).toBeNull();
  });

  it('rejects malformed decimals', () => {
    expect(parseDecimal('1,')).toBeNull();
    expect(parseDecimal(',5')).toBeNull();
    expect(parseDecimal('1.2.3')).toBeNull();
  });

  it('rejects more than two decimal places', () => {
    expect(parseDecimal('1,555')).toBeNull();
    expect(parseDecimal('1.555')).toBeNull();
  });
});

describe('parseUserDate — locale-aware day/month order', () => {
  const originalLanguage = i18n.language;
  afterEach(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  it('reads day-first when the UI language is French', async () => {
    await i18n.changeLanguage('fr');
    expect(parseUserDate('02/09/2026')).toBe('2026-09-02');
    expect(parseUserDate('14/07/2025')).toBe('2025-07-14');
  });

  it('reads month-first when the UI language is English', async () => {
    await i18n.changeLanguage('en');
    expect(parseUserDate('09/02/2026')).toBe('2026-09-02');
    expect(parseUserDate('07/14/2025')).toBe('2025-07-14');
  });

  it('round-trips through formatDate in both locales', async () => {
    for (const lang of ['fr', 'en']) {
      await i18n.changeLanguage(lang);
      const displayed = formatDate('2026-09-02');
      expect(parseUserDate(displayed)).toBe('2026-09-02');
    }
  });

  it('accepts ISO passthrough regardless of locale', async () => {
    for (const lang of ['fr', 'en']) {
      await i18n.changeLanguage(lang);
      expect(parseUserDate('2025-07-14')).toBe('2025-07-14');
    }
  });

  it('rejects impossible dates in either order', async () => {
    await i18n.changeLanguage('en');
    expect(parseUserDate('13/25/2025')).toBeNull();
    await i18n.changeLanguage('fr');
    expect(parseUserDate('32/01/2025')).toBeNull();
  });
});
