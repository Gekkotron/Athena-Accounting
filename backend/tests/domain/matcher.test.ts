import { describe, it, expect } from 'vitest';
import { compileRule, firstMatch, isSafeRulePattern, type CompiledRule } from '../../src/domain/rules/matcher.js';
import type { InferSelectModel } from 'drizzle-orm';
import type { rules } from '../../src/db/schema.js';

type Rule = InferSelectModel<typeof rules>;

const rule = (over: Partial<Rule>): Rule => ({
  id: 1,
  userId: 1,
  categoryId: 10,
  keyword: 'carrefour',
  signConstraint: 'any',
  matchMode: 'word',
  priority: 0,
  enabled: true,
  createdAt: new Date(),
  ...over,
});

describe('compileRule / firstMatch', () => {
  it('word-mode: matches on a whole-word boundary', () => {
    const c = compileRule(rule({ keyword: 'carrefour', matchMode: 'word' }));
    expect(c.test('cb carrefour mulhouse', -10)).toBe(true);
    // Substring inside another word must not match ("paye" ∉ "payweb").
    expect(compileRule(rule({ keyword: 'paye', matchMode: 'word' }))
      .test('payweb', -10)).toBe(false);
  });

  it('substring-mode: matches anywhere in the label without needing a word boundary', () => {
    // "refour" is a proper substring of "carrefour" — word mode would reject
    // it (no leading boundary), substring mode accepts it.
    const cSub = compileRule(rule({ keyword: 'refour', matchMode: 'substring' }));
    expect(cSub.test('cb carrefour mulhouse', -10)).toBe(true);
    const cWord = compileRule(rule({ keyword: 'refour', matchMode: 'word' }));
    expect(cWord.test('cb carrefour mulhouse', -10)).toBe(false);
  });

  it('regex-mode: applies the pattern verbatim (case-insensitive)', () => {
    const c = compileRule(rule({ keyword: '^vir.*alan', matchMode: 'regex' }));
    expect(c.test('vir inst alan foo', -10)).toBe(true);
    expect(c.test('paiement alan carrefour', -10)).toBe(false);
  });

  it('regex-mode with a syntax error compiles to never-match', () => {
    const c = compileRule(rule({ keyword: '(unclosed', matchMode: 'regex' }));
    expect(c.test('anything', -10)).toBe(false);
  });

  it('degenerate keywords (empty after normalization) never match', () => {
    // "VIR " alone → normalizeLabel strips the prefix → empty. The rule
    // must NOT match everything.
    const c = compileRule(rule({ keyword: 'VIR ', matchMode: 'word' }));
    expect(c.test('carrefour', -10)).toBe(false);
    expect(c.test('vir inst alan', -10)).toBe(false);
  });

  it('signConstraint=positive rejects negative amounts', () => {
    const c = compileRule(rule({ keyword: 'salaire', signConstraint: 'positive' }));
    expect(c.test('salaire', 2500)).toBe(true);
    expect(c.test('salaire', -2500)).toBe(false);
  });

  it('signConstraint=negative rejects positive amounts', () => {
    const c = compileRule(rule({ keyword: 'carrefour', signConstraint: 'negative' }));
    expect(c.test('carrefour', -42)).toBe(true);
    expect(c.test('carrefour', 42)).toBe(false);
  });

  it('applies the same normalization to the keyword as to the label', () => {
    // The compileRule strips "VIR INST" from the keyword — so the effective
    // needle is "alan". Callers are expected to pass an already-normalized
    // label; the keyword "VIR INST ALAN" now matches labels that boil down to
    // "alan" (or a phrase containing the word "alan"). Symmetry unlocks
    // matches that a naive raw-keyword approach would miss.
    const c = compileRule(rule({ keyword: 'VIR INST ALAN' }));
    expect(c.test('alan', -10)).toBe(true);
    // A label containing "alan" as a word still matches, since normalization
    // is applied to keywords, not to labels at match time.
    expect(c.test('vir inst alan', -10)).toBe(true);
    // A label without "alan" doesn't match.
    expect(c.test('vir inst monoprix', -10)).toBe(false);
  });

  it('firstMatch returns the first successful rule in order', () => {
    const a = compileRule(rule({ id: 1, keyword: 'monoprix' }));
    const b = compileRule(rule({ id: 2, keyword: 'carrefour' }));
    const list: CompiledRule[] = [a, b];
    expect(firstMatch(list, 'cb carrefour', -10)?.rule.id).toBe(2);
    // If nothing matches, returns null.
    expect(firstMatch(list, 'sncf', -10)).toBeNull();
  });
});

describe('isSafeRulePattern', () => {
  it('accepts simple, well-formed patterns', () => {
    expect(isSafeRulePattern('^vir.*alan$')).toEqual({ ok: true });
    expect(isSafeRulePattern('carrefour|monoprix')).toEqual({ ok: true });
    expect(isSafeRulePattern('sncf\\s*\\d{2,4}')).toEqual({ ok: true });
  });

  it('rejects patterns whose group body pairs a quantifier with a group quantifier (ReDoS)', () => {
    expect(isSafeRulePattern('(a+)+').ok).toBe(false);
    expect(isSafeRulePattern('(a*)*').ok).toBe(false);
    expect(isSafeRulePattern('(x+y)+').ok).toBe(false);
  });

  it('rejects invalid regex syntax', () => {
    const r = isSafeRulePattern('(unclosed');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/invalid regex/i);
  });

  it('rejects patterns beyond the length cap', () => {
    const huge = 'a'.repeat(201);
    const r = isSafeRulePattern(huge);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too long/i);
  });
});
