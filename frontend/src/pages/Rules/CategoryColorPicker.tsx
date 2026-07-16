import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Curated palette — same 10 colors used by Sankey.tsx and CategoryDonut, so
// category colors stay consistent across the app. Extract to a shared module
// if a fourth place needs this list.
const PALETTE = [
  '#7dd3c0', '#dc7861', '#d4a05a', '#7aa8d4', '#b08fd4',
  '#97b87f', '#d48ba8', '#6cc1bb', '#caa97a', '#9cb6d4',
];

interface Props {
  open: boolean;
  categoryName: string;
  current: string | null;
  // Falls back to this when the row has no explicit color, so the native
  // picker opens on the same color the user sees on the row swatch.
  defaultColor: string;
  onApply: (color: string | null) => void;
  onCancel: () => void;
}

export function CategoryColorPicker({
  open,
  categoryName,
  current,
  defaultColor,
  onApply,
  onCancel,
}: Props) {
  const { t } = useTranslation(['rules', 'common']);
  const [customColor, setCustomColor] = useState(current ?? defaultColor);

  useEffect(() => {
    if (open) setCustomColor(current ?? defaultColor);
  }, [open, current, defaultColor]);

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

  const customChanged = customColor.toLowerCase() !== (current ?? '').toLowerCase();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-ink-950/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('colorPicker.dialogAriaLabel', { name: categoryName })}
      onClick={onCancel}
    >
      <div className="surface w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="display text-xl text-ink-50 mb-1 leading-snug">{t('colorPicker.title')}</div>
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
              aria-label={t('colorPicker.swatchAriaLabel', { color: c })}
              onClick={() => onApply(c)}
            />
          ))}
        </div>

        <label className="label mb-1.5 block" htmlFor="color-custom-picker">
          {t('colorPicker.customColorLabel')}
        </label>
        <div className="flex items-center gap-3 mb-5">
          <input
            id="color-custom-picker"
            type="color"
            className="h-10 w-14 rounded-md border border-ink-700 bg-transparent cursor-pointer p-0"
            value={customColor}
            aria-label={t('colorPicker.customColorPickerAriaLabel')}
            onChange={(e) => setCustomColor(e.target.value)}
          />
          <code className="font-mono text-sm text-ink-300">{customColor.toLowerCase()}</code>
          <button
            type="button"
            className="btn-primary ml-auto"
            disabled={!customChanged}
            onClick={() => onApply(customColor.toLowerCase())}
          >
            {t('colorPicker.apply')}
          </button>
        </div>

        <div className="flex justify-between gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => onApply(null)}
            disabled={current == null}
          >
            {t('colorPicker.noColor')}
          </button>
          <button type="button" className="btn-ghost" onClick={onCancel}>
            {t('close', { ns: 'common' })}
          </button>
        </div>
      </div>
    </div>
  );
}
