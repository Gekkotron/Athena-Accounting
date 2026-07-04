import { useState } from 'react';
import { ZoneCanvas, type PageRect } from './ZoneCanvas.js';
import {
  submitZones,
  type PdfImportNeedsTemplate,
  type PdfImportImported,
  type TemplateZones,
} from '../../api/pdf-templates.js';
import { InfoTip } from './InfoTip';
import { StepIndicator } from './StepIndicator';
import { TableStep } from './TableStep';
import { AmountStep } from './AmountStep';
import {
  PAINT_COLOR,
  STEP_ORDER,
  STEP_TOOLTIP,
  type AmountMode,
  type Step,
} from './constants';

interface Props {
  needsTemplate: PdfImportNeedsTemplate;
  onClose: () => void;
  onImported: (r: PdfImportImported) => void;
}

export function PdfTemplateBuilder({ needsTemplate, onClose, onImported }: Props): JSX.Element {
  const firstPage = needsTemplate.pages[0]!;
  const [step, setStep] = useState<Step>('header');

  // Header + table zones get a sensible default so the user has something to
  // nudge if the heuristic already had a guess. Column rectangles start empty —
  // the user paints every one from scratch.
  const [headerRect, setHeaderRect] = useState<PageRect>(
    needsTemplate.suggestedZones?.headerZone ?? {
      x: 0, y: 0, w: firstPage.widthPt, h: firstPage.heightPt * 0.15,
    },
  );
  const [tableRect, setTableRect] = useState<PageRect | null>(
    needsTemplate.suggestedZones
      ? { ...needsTemplate.suggestedZones.tableZone }
      : null,
  );
  const [tableRepeats, setTableRepeats] = useState<boolean>(
    needsTemplate.suggestedZones?.tableRepeatsPerPage ?? true,
  );
  // Which pages of the PDF belong to *this* import / account. Defaults to every
  // page; the user un-ticks pages that belong to a different account. For a
  // single-account statement this just stays as "all".
  const allPageIndices = needsTemplate.pages.map((p) => p.pageIndex);
  const [selectedPages, setSelectedPages] = useState<number[]>(allPageIndices);
  // Optional manual override for the anchor derivation. When null / empty
  // the backend runs its usual heuristics; when set, these are sent
  // verbatim and skip the derivation entirely.
  const [pickedAnchor, setPickedAnchor] = useState<string | null>(null);
  const [pickedOtherAnchors, setPickedOtherAnchors] = useState<string[]>([]);
  const [dateCol, setDateCol] = useState<PageRect | null>(null);
  const [descCol, setDescCol] = useState<PageRect | null>(null);
  // Two-column Débit / Crédit is the dominant layout for French bank PDFs
  // (BNP, LCL, Société Générale, Crédit Agricole, Banque Postale…). Default
  // to that so most users don't have to flip the radio.
  const [amountMode, setAmountMode] = useState<AmountMode>('pair');
  const [signedCol, setSignedCol] = useState<PageRect | null>(null);
  const [debitCol, setDebitCol] = useState<PageRect | null>(null);
  const [creditCol, setCreditCol] = useState<PageRect | null>(null);

  const [label, setLabel] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const stepIdx = STEP_ORDER.indexOf(step);
  const totalSteps = STEP_ORDER.length;

  function goTo(s: Step) {
    setErr(null);
    setStep(s);
  }
  const next = () => goTo(STEP_ORDER[stepIdx + 1] ?? step);
  const prev = () => goTo(STEP_ORDER[stepIdx - 1] ?? step);

  // Auto-advance from a paint-column step as soon as the user finishes
  // drawing a valid rectangle. Only fires on the "column" steps (date,
  // description) where painting is the sole action — the header/table
  // steps have secondary controls (page selection, "table repeats"
  // checkbox) the user needs to interact with, so they still need to
  // click Suivant → manually.
  const onDateChange = (r: PageRect) => {
    setDateCol(r);
    if (step === 'date') goTo('description');
  };
  const onDescChange = (r: PageRect) => {
    setDescCol(r);
    if (step === 'description') goTo('amount');
  };

  // The amount step is the only one with no fixed "next" — it submits instead.
  const isLast = step === 'amount';

  const amountReady =
    amountMode === 'signed' ? signedCol !== null : debitCol !== null && creditCol !== null;
  const canSubmit =
    !!tableRect && !!dateCol && !!descCol && amountReady && label.trim().length > 0;

  function buildZones(): TemplateZones | null {
    if (!tableRect || !dateCol || !descCol) return null;
    const cols: TemplateZones['columns'] = [
      { xStart: dateCol.x, xEnd: dateCol.x + dateCol.w, role: 'date' },
      { xStart: descCol.x, xEnd: descCol.x + descCol.w, role: 'description' },
    ];
    if (amountMode === 'signed') {
      if (!signedCol) return null;
      cols.push({ xStart: signedCol.x, xEnd: signedCol.x + signedCol.w, role: 'amountSigned' });
    } else {
      if (!debitCol || !creditCol) return null;
      cols.push({ xStart: debitCol.x, xEnd: debitCol.x + debitCol.w, role: 'debit' });
      cols.push({ xStart: creditCol.x, xEnd: creditCol.x + creditCol.w, role: 'credit' });
    }
    return {
      headerZone: { page: 0, ...headerRect },
      tableZone: { page: 0, ...tableRect },
      tableRepeatsPerPage: tableRepeats,
      selectedPages: [...selectedPages].sort((a, b) => a - b),
      // Manual overrides — only sent when the user picked something in the
      // anchor picker. Otherwise omitted so the backend runs its usual
      // derivation.
      ...(pickedAnchor ? { pageAnchor: pickedAnchor } : {}),
      ...(pickedOtherAnchors.length > 0 ? { otherAnchors: [...pickedOtherAnchors].sort() } : {}),
      columns: cols,
      rowsStartY: tableRect.y,
    };
  }

  async function handleSubmit() {
    const zones = buildZones();
    if (!zones || !label.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      const result = await submitZones(needsTemplate.draftId, label.trim(), zones);
      onImported(result);
    } catch (e: any) {
      setErr(e?.message ?? 'submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  // Reference rectangles drawn (dashed) under the user's paint, so they can
  // see the table outline + every column they've already drawn. Each canvas
  // hides its own role from the list (otherwise the dashed overlay would
  // fight the user's live paint).
  type Canvas = 'date' | 'description' | 'signed' | 'debit' | 'credit';
  const refsFor = (current: Canvas) => {
    const refs: Array<{ rect: PageRect; label?: string; color?: string }> = [];
    if (tableRect) refs.push({ rect: tableRect, label: 'Tableau', color: '#5b6478' });
    if (current !== 'date' && dateCol) refs.push({ rect: dateCol, label: 'Date', color: '#7dd3c0' });
    if (current !== 'description' && descCol) refs.push({ rect: descCol, label: 'Libellé', color: '#7dd3c0' });
    if (amountMode === 'signed') {
      if (current !== 'signed' && signedCol) refs.push({ rect: signedCol, label: 'Montant', color: '#e69782' });
    } else {
      if (current !== 'debit' && debitCol) refs.push({ rect: debitCol, label: 'Débit', color: '#e69782' });
      if (current !== 'credit' && creditCol) refs.push({ rect: creditCol, label: 'Crédit', color: '#7dd3c0' });
    }
    return refs;
  };

  return (
    <div className="fixed inset-0 bg-ink-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div
        className="bg-ink-900 border border-ink-700 rounded-xl shadow-card max-w-5xl w-full max-h-[92vh] overflow-auto p-6 text-ink-100"
        style={{ backgroundColor: '#11141a', color: '#e6e8ed' }}
      >
        <div className="flex justify-between items-start mb-1">
          <h2 className="display text-xl text-ink-50" style={{ color: '#f4f5f8' }}>
            Définir le template PDF
          </h2>
          <button
            onClick={onClose}
            className="text-ink-300 hover:text-ink-50 transition text-lg leading-none px-2"
            aria-label="Fermer"
          >✕</button>
        </div>

        <StepIndicator currentStep={step} />

        {needsTemplate.reason === 'no_text_layer' && (
          <div className="bg-clay-900/30 border border-clay-800/60 text-clay-200 p-3 rounded-lg mb-4 text-sm">
            Ce PDF semble être une image scannée. La sélection de zones fonctionne, mais l'extraction
            de lignes sera vide — l'OCR n'est pas encore disponible.
          </div>
        )}

        {step === 'header' && (
          <>
            <p className="mb-3 text-sm font-medium text-ink-50 flex items-center gap-2">
              <span>
                Étape 1/{totalSteps} — Sélectionnez l'en-tête{' '}
                <span className="text-ink-400 font-normal">
                  (utilisé pour reconnaître cette banque la prochaine fois)
                </span>.
              </span>
              <InfoTip text={STEP_TOOLTIP.header} />
            </p>
            <ZoneCanvas
              pngBase64={firstPage.pngBase64}
              widthPt={firstPage.widthPt}
              heightPt={firstPage.heightPt}
              initialRect={headerRect}
              paintColor={PAINT_COLOR.header}
              onChange={setHeaderRect}
            />
          </>
        )}

        {step === 'table' && (
          <TableStep
            needsTemplate={needsTemplate}
            totalSteps={totalSteps}
            tableRect={tableRect}
            onTableChange={setTableRect}
            tableRepeats={tableRepeats}
            onTableRepeatsChange={setTableRepeats}
            selectedPages={selectedPages}
            onSelectedPagesChange={setSelectedPages}
            pageAnchor={pickedAnchor}
            otherAnchors={pickedOtherAnchors}
            onPageAnchorChange={setPickedAnchor}
            onOtherAnchorsChange={setPickedOtherAnchors}
          />
        )}

        {step === 'date' && (
          <>
            <p className="mb-3 text-sm font-medium text-ink-50 flex items-center gap-2">
              <span>
                Étape 3/{totalSteps} — Tracez la colonne <span className="text-sage-300">Date</span>{' '}
                <span className="text-ink-400 font-normal">à l'intérieur du tableau — l'étape suivante démarre automatiquement</span>.
              </span>
              <InfoTip text={STEP_TOOLTIP.date} />
            </p>
            <ZoneCanvas
              pngBase64={firstPage.pngBase64}
              widthPt={firstPage.widthPt}
              heightPt={firstPage.heightPt}
              initialRect={dateCol}
              referenceRects={refsFor('date')}
              paintColor={PAINT_COLOR.date}
              paintLabel="Date"
              onChange={onDateChange}
            />
          </>
        )}

        {step === 'description' && (
          <>
            <p className="mb-3 text-sm font-medium text-ink-50 flex items-center gap-2">
              <span>
                Étape 4/{totalSteps} — Tracez la colonne <span className="text-sage-300">Libellé</span>{' '}
                <span className="text-ink-400 font-normal">(description de la transaction — l'étape suivante démarre automatiquement)</span>.
              </span>
              <InfoTip text={STEP_TOOLTIP.description} />
            </p>
            <ZoneCanvas
              pngBase64={firstPage.pngBase64}
              widthPt={firstPage.widthPt}
              heightPt={firstPage.heightPt}
              initialRect={descCol}
              referenceRects={refsFor('description')}
              paintColor={PAINT_COLOR.description}
              paintLabel="Libellé"
              onChange={onDescChange}
            />
          </>
        )}

        {step === 'amount' && (
          <AmountStep
            needsTemplate={needsTemplate}
            totalSteps={totalSteps}
            amountMode={amountMode}
            onAmountModeChange={setAmountMode}
            signedCol={signedCol}
            onSignedChange={setSignedCol}
            debitCol={debitCol}
            onDebitChange={setDebitCol}
            creditCol={creditCol}
            onCreditChange={setCreditCol}
            refsFor={refsFor}
            label={label}
            onLabelChange={setLabel}
            err={err}
          />
        )}

        <div className="flex justify-between gap-2 mt-6">
          <button
            className="px-4 py-2 rounded-lg border border-ink-700 text-ink-200 hover:bg-ink-850 transition disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={prev}
            disabled={stepIdx === 0}
          >← Précédent</button>

          {!isLast ? (
            <button
              className="px-4 py-2 rounded-lg bg-sage-300 text-ink-950 font-medium hover:bg-sage-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={next}
              disabled={
                (step === 'table' && (!tableRect || selectedPages.length === 0)) ||
                (step === 'date' && !dateCol) ||
                (step === 'description' && !descCol)
              }
            >Suivant →</button>
          ) : (
            <button
              className="px-4 py-2 rounded-lg bg-sage-300 text-ink-950 font-medium hover:bg-sage-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
            >{submitting ? 'Import…' : 'Importer'}</button>
          )}
        </div>
      </div>
    </div>
  );
}
