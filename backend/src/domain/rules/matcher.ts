import type { InferSelectModel } from 'drizzle-orm';
import type { rules } from '../../db/schema.js';
import { normalizeLabel } from '../imports/normalize.js';

export type Rule = InferSelectModel<typeof rules>;

export interface CompiledRule {
  rule: Rule;
  test: (normalizedLabel: string, amount: number) => boolean;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Reject the shapes most likely to cause catastrophic backtracking on the
// event loop when POST /api/recategorize matches every rule against every
// transaction. Heuristics rather than a solver — small and dep-free, but
// blocks the obvious footguns:
//   - patterns beyond a hard length cap
//   - a syntactically invalid regex
//   - a group with a quantifier whose body also contains a quantifier
//     (the "(a+)+" / "(a*)*" family)
//   - unbounded upper-bound repetition like "{5,}" that pairs badly with
//     alternation
export const REGEX_PATTERN_MAX_LENGTH = 200;

export function isSafeRulePattern(pattern: string): { ok: true } | { ok: false; reason: string } {
  if (pattern.length > REGEX_PATTERN_MAX_LENGTH) {
    return { ok: false, reason: `regex too long (max ${REGEX_PATTERN_MAX_LENGTH} chars)` };
  }
  try {
    new RegExp(pattern);
  } catch (e) {
    return { ok: false, reason: `invalid regex: ${e instanceof Error ? e.message : String(e)}` };
  }
  // Any group body containing an unbounded quantifier immediately followed
  // by a group-level quantifier — the classic catastrophic-backtracking
  // shape.
  const nested = /\(([^()]*[+*][^()]*|[^()]*\{\d+,\}[^()]*)\)\s*[+*?{]/;
  if (nested.test(pattern)) {
    return { ok: false, reason: 'regex has nested unbounded quantifiers (possible ReDoS)' };
  }
  return { ok: true };
}

function signOk(amount: number, c: Rule['signConstraint']): boolean {
  if (c === 'positive') return amount > 0;
  if (c === 'negative') return amount < 0;
  return true;
}

export function compileRule(rule: Rule): CompiledRule {
  // Apply the same normalization to the keyword that was applied to the
  // transaction's normalized_label at storage time. Without this, a keyword
  // like "VIR INST ALAN" would never match because the "VIR " prefix is
  // stripped during label normalization but kept verbatim in the keyword.
  // The fix is symmetric: stripping both sides means "carrefour" still works
  // as before (it has no prefix to strip), while "VIR INST ALAN" now matches
  // every "vir inst alan ..." transaction.
  const k = normalizeLabel(rule.keyword);

  // A degenerate keyword — e.g. typed as just "VIR " or "27/06" — collapses
  // to the empty string after normalization. Mark such rules as never-match
  // rather than letting them match everything via an empty needle.
  if (!k) {
    return { rule, test: () => false };
  }

  if (rule.matchMode === 'substring') {
    return {
      rule,
      test: (label, amount) =>
        signOk(amount, rule.signConstraint) && label.includes(k),
    };
  }

  if (rule.matchMode === 'regex') {
    // In regex mode the user wrote a deliberate pattern — don't pre-normalize
    // it. Apply it as-is to the (already-normalized) label, catching syntax
    // errors gracefully.
    let re: RegExp | null = null;
    try {
      re = new RegExp(rule.keyword, 'i');
    } catch {
      re = null;
    }
    return {
      rule,
      test: (label, amount) =>
        signOk(amount, rule.signConstraint) && re !== null && re.test(label),
    };
  }

  // word — the default. Word boundaries on the (already normalized) label
  // prevent "paye" from matching "payweb".
  const re = new RegExp(`\\b${escapeRegex(k)}\\b`, 'i');
  return {
    rule,
    test: (label, amount) =>
      signOk(amount, rule.signConstraint) && re.test(label),
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
