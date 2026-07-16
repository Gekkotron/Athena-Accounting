import { useTranslation } from 'react-i18next';
import { normalizeLabel } from '../../lib/normalize';
import type { MatchMode } from '../../api/types';

export function NormalizationHint({
  input,
  matchMode,
}: {
  input: string;
  matchMode: MatchMode;
}) {
  const { t } = useTranslation('rules');
  // Regex mode is a deliberate pattern — we don't pre-normalize it.
  if (matchMode === 'regex' || !input.trim()) return null;

  const parts = input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const transformed = parts.map((p) => ({ raw: p, norm: normalizeLabel(p) }));
  const anyChange = transformed.some(
    (t) => t.norm !== t.raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''),
  );
  const anyEmpty = transformed.some((t) => !t.norm);

  if (!anyChange && !anyEmpty) return null;

  return (
    <div className="text-[11px] mt-1.5 leading-relaxed">
      {anyEmpty && (
        <div className="text-clay-300">
          {t('normalizationHint.emptyWarning')}
        </div>
      )}
      {anyChange && (
        <div className="text-ink-500">
          {t('normalizationHint.willMatchAsPrefix')}{' '}
          {transformed.map((t, i) => (
            <span key={i}>
              <span className={`font-mono ${t.norm ? 'text-sage-300' : 'text-clay-300 line-through'}`}>
                {t.norm || t.raw}
              </span>
              {i < transformed.length - 1 ? ', ' : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
