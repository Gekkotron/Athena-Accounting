import { Trans, useTranslation } from 'react-i18next';
import { ZoneCanvas, type PageRect } from './ZoneCanvas.js';
import { InfoTip } from '../InfoTip';
import type { ReferenceRect } from './lib';

interface Props {
  pngBase64: string;
  widthPt: number;
  heightPt: number;
  initialRect: PageRect | null;
  referenceRects: ReferenceRect[];
  paintColor: string | undefined;
  paintLabel: string;
  onChange: (r: PageRect) => void;
  promptI18nKey: string;
  tooltipI18nKey: string;
  totalSteps: number;
}

// Shared JSX shell for the two paint-only column steps (date, description) —
// same prompt + tooltip + canvas structure, only the i18n keys, paint colour,
// and reference-rect list differ.
export function ColumnStep({
  pngBase64,
  widthPt,
  heightPt,
  initialRect,
  referenceRects,
  paintColor,
  paintLabel,
  onChange,
  promptI18nKey,
  tooltipI18nKey,
  totalSteps,
}: Props): JSX.Element {
  const { t } = useTranslation('pdf-template');
  return (
    <>
      <p className="mb-3 text-sm font-medium text-ink-50 flex items-center gap-2">
        <span>
          <Trans
            i18nKey={`pdf-template:${promptI18nKey}`}
            values={{ total: totalSteps }}
            components={{
              1: <span className="text-sage-300" />,
              2: <span className="text-ink-400 font-normal" />,
            }}
          />
        </span>
        <InfoTip text={t(tooltipI18nKey)} />
      </p>
      <ZoneCanvas
        pngBase64={pngBase64}
        widthPt={widthPt}
        heightPt={heightPt}
        initialRect={initialRect}
        referenceRects={referenceRects}
        paintColor={paintColor}
        paintLabel={paintLabel}
        onChange={onChange}
      />
    </>
  );
}
