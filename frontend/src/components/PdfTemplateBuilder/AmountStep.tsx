import { ZoneCanvas, type PageRect } from './ZoneCanvas.js';
import { InfoTip } from './InfoTip';
import { PAINT_COLOR, STEP_TOOLTIP, type AmountMode } from './constants';
import type { PdfImportNeedsTemplate } from '../../api/pdf-templates.js';

interface ColumnRefs {
  rect: PageRect;
  label?: string;
  color?: string;
}

interface Props {
  needsTemplate: PdfImportNeedsTemplate;
  totalSteps: number;
  amountMode: AmountMode;
  onAmountModeChange: (m: AmountMode) => void;
  signedCol: PageRect | null;
  onSignedChange: (r: PageRect) => void;
  debitCol: PageRect | null;
  onDebitChange: (r: PageRect) => void;
  creditCol: PageRect | null;
  onCreditChange: (r: PageRect) => void;
  refsFor: (current: 'signed' | 'debit' | 'credit') => ColumnRefs[];
  label: string;
  onLabelChange: (v: string) => void;
  err: string | null;
}

export function AmountStep({
  needsTemplate,
  totalSteps,
  amountMode,
  onAmountModeChange,
  signedCol,
  onSignedChange,
  debitCol,
  onDebitChange,
  creditCol,
  onCreditChange,
  refsFor,
  label,
  onLabelChange,
  err,
}: Props): JSX.Element {
  const firstPage = needsTemplate.pages[0]!;
  return (
    <>
      <p className="mb-3 text-sm font-medium text-ink-50 flex items-center gap-2">
        <span>
          Étape 5/{totalSteps} — Tracez la colonne <span className="text-clay-300">Montant</span>.
        </span>
        <InfoTip text={STEP_TOOLTIP.amount} />
      </p>
      <fieldset className="mb-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-200">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="amount-mode"
            checked={amountMode === 'signed'}
            onChange={() => onAmountModeChange('signed')}
            className="accent-clay-300"
          />
          <span>Une colonne <span className="text-ink-400">(montants positifs et négatifs)</span></span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="amount-mode"
            checked={amountMode === 'pair'}
            onChange={() => onAmountModeChange('pair')}
            className="accent-clay-300"
          />
          <span>Deux colonnes <span className="text-ink-400">(Débit + Crédit)</span></span>
        </label>
      </fieldset>

      {amountMode === 'signed' ? (
        <>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-clay-300 mb-2">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-clay-300" /> Colonne Montant
          </h3>
          <ZoneCanvas
            pngBase64={firstPage.pngBase64}
            widthPt={firstPage.widthPt}
            heightPt={firstPage.heightPt}
            initialRect={signedCol}
            referenceRects={refsFor('signed')}
            paintColor={PAINT_COLOR.amount}
            paintLabel="Montant"
            onChange={onSignedChange}
          />
        </>
      ) : (
        <div className="grid gap-5">
          <div className="border-l-4 border-clay-300 pl-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-clay-300 mb-2">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-clay-300" />
              Canvas 1/2 — Tracez la colonne <span className="uppercase tracking-wide">Débit</span>
            </h3>
            <ZoneCanvas
              pngBase64={firstPage.pngBase64}
              widthPt={firstPage.widthPt}
              heightPt={firstPage.heightPt}
              initialRect={debitCol}
              referenceRects={refsFor('debit')}
              paintColor={PAINT_COLOR.amount}
              paintLabel="Débit"
              onChange={onDebitChange}
              displayMaxWidth={520}
            />
          </div>
          <div className="border-l-4 border-sage-300 pl-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-sage-300 mb-2">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-sage-300" />
              Canvas 2/2 — Tracez la colonne <span className="uppercase tracking-wide">Crédit</span>
            </h3>
            <ZoneCanvas
              pngBase64={firstPage.pngBase64}
              widthPt={firstPage.widthPt}
              heightPt={firstPage.heightPt}
              initialRect={creditCol}
              referenceRects={refsFor('credit')}
              paintColor="#7dd3c0"
              paintLabel="Crédit"
              onChange={onCreditChange}
              displayMaxWidth={520}
            />
          </div>
        </div>
      )}

      <div className="mt-5">
        <label className="block text-sm text-ink-200 mb-1.5">Nom du template</label>
        <input
          className="w-full rounded-lg border border-ink-700 bg-ink-850 text-ink-100 placeholder-ink-500 px-3 py-2 text-sm focus:border-sage-300 focus:outline-none transition"
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          placeholder="ex: BNP — Compte Chèques"
        />
      </div>
      {err && <p className="mt-3 text-sm text-clay-300">{err}</p>}
    </>
  );
}
