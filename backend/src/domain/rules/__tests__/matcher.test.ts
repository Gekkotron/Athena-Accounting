import { describe, it, expect } from 'vitest';
import {
  REGEX_PATTERN_MAX_LENGTH,
  compileRule,
  firstMatch,
  isSafeRulePattern,
  type CompiledRule,
  type Rule,
} from '../matcher.js';

let nextId = 1;
const rule = (o: Partial<Rule> = {}): Rule =>
  ({
    id: nextId++,
    userId: 1,
    keyword: 'carrefour',
    matchMode: 'word',
    signConstraint: 'any',
    categoryId: 10,
    priority: 0,
    enabled: true,
    ...o,
  }) as unknown as Rule;

describe('isSafeRulePattern', () => {
  it('accepts ordinary patterns', () => {
    expect(isSafeRulePattern('carrefour|lidl')).toEqual({ ok: true });
    expect(isSafeRulePattern('^edf\\b')).toEqual({ ok: true });
    expect(isSafeRulePattern('(abc)+')).toEqual({ ok: true });
  });

  it('rejects patterns over the length cap', () => {
    const r = isSafeRulePattern('a'.repeat(REGEX_PATTERN_MAX_LENGTH + 1));
    expect(r.ok).toBe(false);
    expect(isSafeRulePattern('a'.repeat(REGEX_PATTERN_MAX_LENGTH)).ok).toBe(true);
  });

  it('rejects syntactically invalid regexes', () => {
    const r = isSafeRulePattern('(unclosed');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/invalid regex/);
  });

  it.each(['(a+)+', '(a*)*', '(a+)*', '(a|b+)+', '(a{2,})+'])('rejects nested quantifier %s', (p) => {
    const r = isSafeRulePattern(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/ReDoS/);
  });
});

describe('compileRule — word mode', () => {
  it('matches on word boundaries only', () => {
    const c = compileRule(rule({ keyword: 'paye' }));
    expect(c.test('paye mensuelle', -1)).toBe(true);
    expect(c.test('payweb', -1)).toBe(false);
    expect(c.test('prepaye', -1)).toBe(false);
  });

  it('is case-insensitive on the label', () => {
    expect(compileRule(rule({ keyword: 'carrefour' })).test('CARREFOUR CITY', -5)).toBe(true);
  });

  it('folds French accents in the keyword', () => {
    const c = compileRule(rule({ keyword: 'Crédit Agricole' }));
    expect(c.test('credit agricole', -5)).toBe(true);
  });

  it('strips payment prefixes from the keyword like labels are', () => {
    const c = compileRule(rule({ keyword: 'VIR INST ALAN' }));
    expect(c.test('alan sante', -5)).toBe(true);
  });

  it('escapes regex metacharacters in the keyword', () => {
    const c = compileRule(rule({ keyword: 'a.b+c' }));
    expect(c.test('a.b+c', -1)).toBe(true);
    expect(c.test('axbbc', -1)).toBe(false);
  });
});

describe('compileRule — substring mode', () => {
  it('matches inside words', () => {
    const c = compileRule(rule({ keyword: 'pay', matchMode: 'substring' }));
    expect(c.test('payweb', -1)).toBe(true);
    expect(c.test('prepaye', -1)).toBe(true);
    expect(c.test('lidl', -1)).toBe(false);
  });

  it('matches against the lowercase normalized keyword', () => {
    const c = compileRule(rule({ keyword: 'ÉLECTRICITÉ', matchMode: 'substring' }));
    expect(c.test('facture electricite', -1)).toBe(true);
  });
});

describe('compileRule — regex mode', () => {
  it('uses the raw keyword as a case-insensitive regex', () => {
    const c = compileRule(rule({ keyword: 'carrefour|lidl', matchMode: 'regex' }));
    expect(c.test('lidl paris', -1)).toBe(true);
    expect(c.test('LIDL', -1)).toBe(true);
    expect(c.test('aldi', -1)).toBe(false);
  });

  it('never matches on an invalid regex instead of throwing', () => {
    const c = compileRule(rule({ keyword: '(unclosed', matchMode: 'regex' }));
    expect(() => c.test('anything (unclosed', -1)).not.toThrow();
    expect(c.test('anything (unclosed', -1)).toBe(false);
  });
});

describe('compileRule — degenerate keywords', () => {
  it.each(['', '   ', 'VIR ', '27/06'])('never matches for keyword %j', (kw) => {
    const c = compileRule(rule({ keyword: kw }));
    expect(c.test('anything at all', -1)).toBe(false);
    expect(c.test('', 1)).toBe(false);
  });
});

describe('compileRule — sign constraint', () => {
  it.each(['word', 'substring', 'regex'] as const)('honors positive/negative in %s mode', (matchMode) => {
    const pos = compileRule(rule({ keyword: 'salaire', matchMode, signConstraint: 'positive' }));
    const neg = compileRule(rule({ keyword: 'salaire', matchMode, signConstraint: 'negative' }));
    const any = compileRule(rule({ keyword: 'salaire', matchMode, signConstraint: 'any' }));
    expect(pos.test('salaire', 100)).toBe(true);
    expect(pos.test('salaire', -100)).toBe(false);
    expect(neg.test('salaire', -100)).toBe(true);
    expect(neg.test('salaire', 100)).toBe(false);
    expect(any.test('salaire', 100)).toBe(true);
    expect(any.test('salaire', -100)).toBe(true);
  });

  it('treats a zero amount as neither positive nor negative', () => {
    expect(compileRule(rule({ signConstraint: 'positive' })).test('carrefour', 0)).toBe(false);
    expect(compileRule(rule({ signConstraint: 'negative' })).test('carrefour', 0)).toBe(false);
    expect(compileRule(rule({ signConstraint: 'any' })).test('carrefour', 0)).toBe(true);
  });
});

describe('firstMatch', () => {
  const mk = (kw: string, categoryId: number, extra: Partial<Rule> = {}): CompiledRule =>
    compileRule(rule({ keyword: kw, categoryId, ...extra }));

  it('returns the first matching rule in the given order', () => {
    const list = [mk('amazon', 1), mk('amazon prime', 2)];
    expect(firstMatch(list, 'amazon prime video', -9)?.rule.categoryId).toBe(1);
    expect(firstMatch([...list].reverse(), 'amazon prime video', -9)?.rule.categoryId).toBe(2);
  });

  it('skips rules whose sign constraint fails', () => {
    const list = [mk('amazon', 1, { signConstraint: 'positive' }), mk('amazon', 2)];
    expect(firstMatch(list, 'amazon', -9)?.rule.categoryId).toBe(2);
    expect(firstMatch(list, 'amazon', 9)?.rule.categoryId).toBe(1);
  });

  it('returns null when nothing matches or the list is empty', () => {
    expect(firstMatch([mk('amazon', 1)], 'lidl', -1)).toBeNull();
    expect(firstMatch([], 'lidl', -1)).toBeNull();
  });
});
