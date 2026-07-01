import type { Rule, SignConstraint, MatchMode } from '../../api/types';

const SIGN_LABEL: Record<SignConstraint, string> = {
  positive: 'Positif',
  negative: 'Négatif',
  any: 'Tous',
};

const MATCH_LABEL: Record<MatchMode, string> = {
  word: 'Mot entier',
  substring: 'Sous-chaîne',
  regex: 'Regex',
};

export function Chip({
  rule,
  onToggle,
  onAdvanced,
  onDelete,
}: {
  rule: Rule;
  onToggle: () => void;
  onAdvanced: () => void;
  onDelete: () => void;
}) {
  const tooltip = `Priorité ${rule.priority} · ${SIGN_LABEL[rule.signConstraint]} · ${MATCH_LABEL[rule.matchMode]}${rule.enabled ? '' : ' · désactivée'}`;
  return (
    <span
      className={`group inline-flex items-center gap-1 rounded-full border pl-2.5 pr-1 py-0.5 text-xs font-mono transition ${
        rule.enabled
          ? 'border-sage-800/40 bg-sage-900/20 text-sage-200 hover:border-sage-700/60'
          : 'border-ink-800 bg-ink-900 text-ink-500 line-through hover:text-ink-300'
      }`}
      title={tooltip}
    >
      <button onClick={onToggle} className="py-0.5">
        {rule.keyword}
      </button>
      <button
        onClick={onAdvanced}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-ink-400 hover:text-ink-100 transition px-0.5"
        aria-label="Modifier"
        title="Modifier (priorité, signe, mode)"
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
          <path d="M2 7.5l5-5 1.5 1.5-5 5L2 9.5V7.5z" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-ink-400 hover:text-clay-300 transition px-0.5 mr-0.5"
        aria-label="Supprimer"
        title="Supprimer"
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
          <path d="M2 2l7 7M9 2L2 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
    </span>
  );
}
