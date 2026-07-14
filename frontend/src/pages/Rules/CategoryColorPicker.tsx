import { useEffect, useState } from 'react';

// Curated palette — same 10 colors used by Sankey.tsx and CategoryDonut, so
// category colors stay consistent across the app. Extract to a shared module
// if a fourth place needs this list.
const PALETTE = [
  '#7dd3c0', '#dc7861', '#d4a05a', '#7aa8d4', '#b08fd4',
  '#97b87f', '#d48ba8', '#6cc1bb', '#caa97a', '#9cb6d4',
];

const HEX_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

interface Props {
  open: boolean;
  categoryName: string;
  current: string | null;
  onApply: (color: string | null) => void;
  onCancel: () => void;
}

export function CategoryColorPicker({ open, categoryName, current, onApply, onCancel }: Props) {
  const [customHex, setCustomHex] = useState(current ?? '');

  useEffect(() => {
    if (open) setCustomHex(current ?? '');
  }, [open, current]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const trimmed = customHex.trim();
  const hexValid = HEX_RE.test(trimmed);
  const hexChanged = trimmed !== (current ?? '');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-ink-950/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Choisir une couleur pour « ${categoryName} »`}
      onClick={onCancel}
    >
      <div className="surface w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="display text-xl text-ink-50 mb-1 leading-snug">Couleur</div>
        <div className="text-sm text-ink-400 mb-4">
          « <span className="text-ink-200">{categoryName}</span> »
        </div>

        <div className="grid grid-cols-5 gap-2 mb-5">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              className={
                `h-10 w-10 rounded-full border transition ` +
                (c === current
                  ? 'border-ink-100 ring-2 ring-sage-300/60'
                  : 'border-ink-700 hover:border-ink-400')
              }
              style={{ backgroundColor: c }}
              aria-label={`Couleur ${c}`}
              onClick={() => onApply(c)}
            />
          ))}
        </div>

        <label className="label mb-1.5 block" htmlFor="color-custom-hex">
          Couleur personnalisée
        </label>
        <div className="flex gap-2 mb-5">
          <input
            id="color-custom-hex"
            className="input font-mono flex-1"
            value={customHex}
            placeholder="#7dd3c0"
            onChange={(e) => setCustomHex(e.target.value)}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={!hexValid || !hexChanged}
            onClick={() => onApply(trimmed)}
          >
            Appliquer
          </button>
        </div>

        <div className="flex justify-between gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => onApply(null)}
            disabled={current == null}
          >
            Aucune couleur
          </button>
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
