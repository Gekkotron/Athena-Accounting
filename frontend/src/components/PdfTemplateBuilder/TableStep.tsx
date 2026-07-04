import { ZoneCanvas, type PageRect } from './ZoneCanvas.js';
import { InfoTip } from './InfoTip';
import { ExtractedTextPanel } from './ExtractedTextPanel';
import { AnchorPickerPanel } from './AnchorPickerPanel';
import { PAINT_COLOR, STEP_TOOLTIP } from './constants';
import type { PdfImportNeedsTemplate } from '../../api/pdf-templates.js';

interface Props {
  needsTemplate: PdfImportNeedsTemplate;
  totalSteps: number;
  tableRect: PageRect | null;
  onTableChange: (r: PageRect) => void;
  tableRepeats: boolean;
  onTableRepeatsChange: (v: boolean) => void;
  selectedPages: number[];
  onSelectedPagesChange: (updater: (prev: number[]) => number[]) => void;
  pageAnchor: string | null;
  otherAnchors: string[];
  onPageAnchorChange: (a: string | null) => void;
  onOtherAnchorsChange: (updater: (prev: string[]) => string[]) => void;
}

export function TableStep({
  needsTemplate,
  totalSteps,
  tableRect,
  onTableChange,
  tableRepeats,
  onTableRepeatsChange,
  selectedPages,
  onSelectedPagesChange,
  pageAnchor,
  otherAnchors,
  onPageAnchorChange,
  onOtherAnchorsChange,
}: Props): JSX.Element {
  const firstPage = needsTemplate.pages[0]!;
  return (
    <>
      <p className="mb-3 text-sm font-medium text-ink-50 flex items-center gap-2">
        <span>
          Étape 2/{totalSteps} — Sélectionnez le tableau des transactions{' '}
          <span className="text-ink-400 font-normal">(toutes les lignes, en-tête de colonne incluse)</span>.
        </span>
        <InfoTip text={STEP_TOOLTIP.table} />
      </p>
      <ZoneCanvas
        pngBase64={firstPage.pngBase64}
        widthPt={firstPage.widthPt}
        heightPt={firstPage.heightPt}
        initialRect={tableRect}
        paintColor={PAINT_COLOR.table}
        onChange={onTableChange}
      />
      <label className="flex items-center gap-2 mt-4 text-sm text-ink-200">
        <input
          type="checkbox"
          checked={tableRepeats}
          onChange={(e) => onTableRepeatsChange(e.target.checked)}
          className="accent-sage-300"
        />
        Le tableau se répète sur chaque page
      </label>

      {needsTemplate.pages.length > 1 && (
        <div className="mt-5 pt-4 border-t border-ink-800/60">
          <div className="text-sm text-ink-100 font-medium mb-1">
            Pages à importer pour ce compte
          </div>
          <p className="text-xs text-ink-400 mb-3">
            Si le relevé contient plusieurs comptes, ne cochez que les pages qui appartiennent au
            compte choisi à l'upload. Les autres pages seront ignorées pour cet import.
          </p>
          <div className="flex flex-wrap gap-2">
            {needsTemplate.pages.map((p) => {
              const checked = selectedPages.includes(p.pageIndex);
              return (
                <label
                  key={p.pageIndex}
                  className={
                    'cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition ' +
                    (checked
                      ? 'border-sage-300 bg-sage-300/10 text-sage-300'
                      : 'border-ink-700 text-ink-400 hover:text-ink-200')
                  }
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={(e) => {
                      onSelectedPagesChange((prev) =>
                        e.target.checked
                          ? Array.from(new Set([...prev, p.pageIndex])).sort((a, b) => a - b)
                          : prev.filter((i) => i !== p.pageIndex),
                      );
                    }}
                  />
                  Page {p.pageIndex + 1}
                </label>
              );
            })}
          </div>
          {selectedPages.length === 0 && (
            <p className="mt-2 text-xs text-clay-300">
              Sélectionnez au moins une page.
            </p>
          )}
        </div>
      )}

      <AnchorPickerPanel
        needsTemplate={needsTemplate}
        pageAnchor={pageAnchor}
        otherAnchors={otherAnchors}
        onPageAnchorChange={onPageAnchorChange}
        onOtherAnchorsChange={onOtherAnchorsChange}
      />

      <ExtractedTextPanel needsTemplate={needsTemplate} />
    </>
  );
}
