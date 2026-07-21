import { Trans, useTranslation } from 'react-i18next';
import { ZoneCanvas, type PageRect } from './ZoneCanvas.js';
import { InfoTip } from '../InfoTip';
import { PAINT_COLOR } from './constants';

interface Props {
  pngBase64: string;
  widthPt: number;
  heightPt: number;
  headerRect: PageRect;
  onHeaderChange: (r: PageRect) => void;
  totalSteps: number;
}

export function HeaderStep({
  pngBase64,
  widthPt,
  heightPt,
  headerRect,
  onHeaderChange,
  totalSteps,
}: Props): JSX.Element {
  const { t } = useTranslation('pdf-template');
  return (
    <>
      <p className="mb-3 text-sm font-medium text-ink-50 flex items-center gap-2">
        <span>
          <Trans
            i18nKey="pdf-template:headerStep.prompt"
            values={{ total: totalSteps }}
            components={{ 1: <span className="text-ink-400 font-normal" /> }}
          />
        </span>
        <InfoTip text={t('steps.header.tooltip')} />
      </p>
      <ZoneCanvas
        pngBase64={pngBase64}
        widthPt={widthPt}
        heightPt={heightPt}
        initialRect={headerRect}
        paintColor={PAINT_COLOR.header}
        onChange={onHeaderChange}
      />
    </>
  );
}
