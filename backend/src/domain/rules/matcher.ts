import type { InferSelectModel } from 'drizzle-orm';
import type { rules } from '../../db/schema.js';

export type Rule = InferSelectModel<typeof rules>;

export interface CompiledRule {
  rule: Rule;
  test: (normalizedLabel: string, amount: number) => boolean;
}

const ACCENT_RE = /[̀-ͯ]/g;

// Same fold as in normalizeLabel — lowercase + strip diacritics. Keeping the
// fold here (rather than reusing normalizeLabel) is intentional: the rule
// matcher operates on `transactions.normalized_label` which is already
// prefix/date-stripped, so we only need to align case and accents.
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(ACCENT_RE, '');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function signOk(amount: number, c: Rule['signConstraint']): boolean {
  if (c === 'positive') return amount > 0;
  if (c === 'negative') return amount < 0;
  return true;
}

export function compileRule(rule: Rule): CompiledRule {
  const k = fold(rule.keyword);

  if (rule.matchMode === 'substring') {
    return {
      rule,
      test: (label, amount) => signOk(amount, rule.signConstraint) && fold(label).includes(k),
    };
  }

  if (rule.matchMode === 'regex') {
    // Compile against the folded keyword; tolerate user-written regexes by
    // catching syntax errors and treating them as a non-match.
    let re: RegExp | null = null;
    try {
      re = new RegExp(rule.keyword, 'i');
    } catch {
      re = null;
    }
    return {
      rule,
      test: (label, amount) =>
        signOk(amount, rule.signConstraint) && re !== null && re.test(fold(label)),
    };
  }

  // word — the default. Word boundaries on the folded label prevent
  // "paye" from matching "payweb".
  const re = new RegExp(`\\b${escapeRegex(k)}\\b`, 'i');
  return {
    rule,
    test: (label, amount) => signOk(amount, rule.signConstraint) && re.test(fold(label)),
  };
}

// Walk rules in their given order and return the first match. Caller sorts.
export function firstMatch(
  compiled: readonly CompiledRule[],
  normalizedLabel: string,
  amount: number,
): CompiledRule | null {
  for (const c of compiled) {
    if (c.test(normalizedLabel, amount)) return c;
  }
  return null;
}
