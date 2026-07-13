import { useEffect, useRef, useState } from 'react';
import { ZoneCanvas, type PageRect } from './ZoneCanvas.js';
import {
  submitZones,
  previewZones,
  getDraft,
  type PdfImportNeedsTemplate,
  type PdfImportImported,
  type TemplateZones,
  type PreviewResult,
  type PdfTextItem,
} from '../../api/pdf-templates.js';
import { InfoTip } from './InfoTip';
import { StepIndicator } from './StepIndicator';
import { TableStep } from './TableStep';
import { AmountStep } from './AmountStep';
import { OcrProgress } from './OcrProgress';
import { PreviewTable, type PreviewRow } from './PreviewTable';
import {
  PAINT_COLOR,
  STEP_ORDER,
  STEP_TOOLTIP,
  type AmountMode,
  type Step,
} from './constants';
import { formatAmount, formatDate, amountSignClass } from '../../lib/format';

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

  const [previewRows, setPreviewRows] = useState<PreviewResult['rows'] | null>(null);
  const [previewSkipped, setPreviewSkipped] = useState<PreviewResult['skippedRows']>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // OCR path: this draft came from a scanned/photo statement, so its
  // text_items are populated asynchronously by a background job. Until that
  // job flips the draft to 'ready', we show a polling progress screen
  // instead of the zone-painting steps.
  const isOcrSource =
    needsTemplate.ocrStatus === 'pending' || needsTemplate.reason === 'no_text_layer';
  const [ocrReady, setOcrReady] = useState(needsTemplate.ocrStatus !== 'pending');
  const [ocrError, setOcrError] = useState<string | null>(null);
  // Populated by a one-shot refetch of the draft once OCR finishes — the
  // initial needsTemplate.textItems is empty for an OCR source (nothing had
  // been recognized yet at upload time).
  const [freshTextItems, setFreshTextItems] = useState<PdfTextItem[] | null>(null);
  const effectiveNeedsTemplate: PdfImportNeedsTemplate = freshTextItems
    ? { ...needsTemplate, textItems: freshTextItems }
    : needsTemplate;

  async function handleOcrReady() {
    setOcrReady(true);
    try {
      const draft = await getDraft(needsTemplate.draftId);
      setFreshTextItems(draft.textItems);
    } catch {
      setOcrError('Impossible de charger le texte reconnu — réessayez.');
    }
  }

  // Rows the user hand-fixes in the editable preview table, on the OCR
  // path only. Reset whenever a fresh preview is fetched (or cleared).
  const [editableRows, setEditableRows] = useState<PreviewRow[]>([]);
  useEffect(() => {
    if (!isOcrSource) return;
    setEditableRows(
      previewRows
        ? previewRows.map((r) => ({ date: r.date, label: r.rawLabel, amount: r.amount, confidence: r.confidence }))
        : [],
    );
  }, [previewRows, isOcrSource]);
  // Guards against a stale in-flight preview response landing after the
  // zones have changed (and thus the reset effect below already ran).
  // Every call to handlePreview claims a new id; any setState it performs
  // is only applied if its id is still the current one when the response
  // arrives. The reset effect also bumps this so an in-flight request that
  // resolves after a re-paint is ignored even if no *new* preview was
  // requested in the meantime.
  const previewReqIdRef = useRef<number>(0);

  // Whenever any painted zone or wizard-configuration input changes, wipe
  // the preview so the user never sees a stale table that no longer
  // reflects the current paint.
  useEffect(() => {
    previewReqIdRef.current += 1;
    setPreviewRows(null);
    setPreviewSkipped([]);
    setPreviewError(null);
  }, [
    tableRect, tableRepeats, dateCol, descCol, signedCol, debitCol, creditCol,
    amountMode, headerRect, selectedPages, pickedAnchor, pickedOtherAnchors,
  ]);

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

  async function handlePreview() {
    const zones = buildZones();
    if (!zones) return;
    // Claim this request's id. If the zones change (and the reset effect
    // bumps the ref) before the response lands, every setState below is
    // skipped — the response belongs to a configuration that's no longer
    // current.
    const myReqId = ++previewReqIdRef.current;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const r = await previewZones(needsTemplate.draftId, zones);
      if (myReqId !== previewReqIdRef.current) return; // stale response, ignore
      setPreviewRows(r.rows);
      setPreviewSkipped(r.skippedRows);
    } catch (e: any) {
      if (myReqId !== previewReqIdRef.current) return; // stale response, ignore
      setPreviewError(e?.message ?? 'preview failed');
      setPreviewRows(null);
      setPreviewSkipped([]);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleSubmit(overrideRows?: Array<{ date: string; label: string; amount: string }>) {
    const zones = buildZones();
    if (!zones || !label.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      const result = await submitZones(needsTemplate.draftId, label.trim(), zones, overrideRows);
      onImported(result);
    } catch (e: any) {
      setErr(e?.message ?? 'submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  // Import trigger for the OCR path's editable PreviewTable: sends the
  // user's hand-fixed rows verbatim instead of letting the backend
  // re-parse the zones (see override_rows on POST /api/imports/pdf/templates).
  function handleOcrImport() {
    return handleSubmit(editableRows.map((r) => ({ date: r.date, label: r.label, amount: r.amount })));
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

        {isOcrSource && !ocrReady ? (
          <>
            <OcrProgress
              draftId={needsTemplate.draftId}
              onReady={handleOcrReady}
              onError={setOcrError}
            />
            {ocrError && (
              <p className="text-center text-xs text-ink-500 -mt-6">
                Fermez cette fenêtre et réessayez avec un fichier plus net ou mieux cadré.
              </p>
            )}
          </>
        ) : (
        <>
        <StepIndicator currentStep={step} />

        {needsTemplate.reason === 'template_stale' && (
          <div className="bg-clay-900/30 border border-clay-800/60 text-clay-200 p-3 rounded-lg mb-4 text-sm">
            <div className="font-medium mb-1">Le template précédent ne correspond plus à ce PDF</div>
            <div className="text-clay-300/90 text-xs leading-relaxed">
              {needsTemplate.staleDiagnostic
                ?? 'Le template a été appliqué mais n\'a produit aucune ligne. Reconfigurez les zones ci-dessous.'}
            </div>
            <div className="text-clay-300/70 text-xs mt-2">
              Le template existant sera remplacé par cette nouvelle version quand vous cliquerez sur « Importer ».
            </div>
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
            needsTemplate={effectiveNeedsTemplate}
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
            needsTemplate={effectiveNeedsTemplate}
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

        {step === 'amount' && (
          <div className="mt-6 border-t border-ink-800/60 pt-5">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-ink-100">
                Aperçu
                {previewRows && (
                  <span className="text-ink-500 font-normal font-mono ml-2">
                    ({previewRows.length} ligne{previewRows.length !== 1 ? 's' : ''})
                  </span>
                )}
              </div>
              <button
                className="px-3 py-1.5 rounded-lg border border-ink-700 text-ink-200 hover:bg-ink-850 transition text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={handlePreview}
                disabled={!canSubmit || previewLoading}
                type="button"
              >
                {previewLoading ? 'Aperçu…' : 'Aperçu'}
              </button>
            </div>
            {previewError && (
              <div className="text-clay-300 bg-clay-900/30 border border-clay-800/60 p-2 rounded-md text-xs mb-2">
                {previewError}
              </div>
            )}
            {previewRows === null && !previewLoading && !previewError && (
              <div className="text-xs text-ink-500 display-italic">
                Cliquez sur <span className="font-medium not-italic text-ink-400">Aperçu</span> pour vérifier avant l'import.
              </div>
            )}
            {previewRows && previewRows.length === 0 && (
              <div className="text-xs text-clay-300 display-italic">
                Aucune ligne extraite. Vérifiez que les colonnes couvrent bien le tableau.
              </div>
            )}
            {previewRows && previewRows.length > 0 && isOcrSource && (
              <PreviewTable
                rows={editableRows}
                editable
                onChange={(i, patch) =>
                  setEditableRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
                }
                onDelete={(i) => setEditableRows((rows) => rows.filter((_, idx) => idx !== i))}
                onImport={handleOcrImport}
                importing={submitting}
              />
            )}
            {previewRows && previewRows.length > 0 && !isOcrSource && (
              <div className="max-h-72 overflow-y-auto pr-1">
                <table className="w-full text-xs">
                  <thead className="text-left text-ink-500">
                    <tr>
                      <th className="py-1.5 pr-3 font-normal">Date</th>
                      <th className="py-1.5 pr-3 font-normal">Libellé</th>
                      <th className="py-1.5 pl-3 font-normal text-right">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, i) => (
                      <tr key={i} className="border-t border-ink-800/40">
                        <td className="py-1.5 pr-3 font-mono text-ink-300 whitespace-nowrap">{formatDate(r.date)}</td>
                        <td className="py-1.5 pr-3 text-ink-100">
                          <div className="truncate max-w-[26rem]" title={r.rawLabel}>{r.rawLabel}</div>
                        </td>
                        <td className={`py-1.5 pl-3 text-right font-mono tabular-nums whitespace-nowrap ${amountSignClass(r.amount)}`}>
                          {formatAmount(r.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {previewSkipped.length > 0 && (
              <details className="mt-3 text-xs text-ink-500">
                <summary className="cursor-pointer">{previewSkipped.length} ligne(s) ignorée(s)</summary>
                <ul className="mt-2 space-y-1 font-mono">
                  {previewSkipped.map((s, i) => (
                    <li key={i}><code>{s.rowText}</code> — {s.reason}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
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
          ) : !isOcrSource ? (
            <button
              className="px-4 py-2 rounded-lg bg-sage-300 text-ink-950 font-medium hover:bg-sage-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => handleSubmit()}
              disabled={!canSubmit || submitting}
            >{submitting ? 'Import…' : 'Importer'}</button>
          ) : null}
        </div>
        </>
        )}
      </div>
    </div>
  );
}
