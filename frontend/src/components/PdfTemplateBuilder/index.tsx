import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type PageRect } from './ZoneCanvas.js';
import {
  submitZones,
  previewZones,
  getDraft,
  type PdfImportNeedsTemplate,
  type PdfImportImported,
  type PreviewResult,
  type PdfTextItem,
} from '../../api/pdf-templates.js';
import { errorMessage } from '../../api/errorMessage';
import { StepIndicator } from './StepIndicator';
import { TableStep } from './TableStep';
import { AmountStep } from './AmountStep';
import { OcrProgress } from './OcrProgress';
import { type PreviewRow } from './PreviewTable';
import { PAINT_COLOR, STEP_ORDER, type AmountMode, type Step } from './constants';
import {
  buildZones,
  buildReferenceRects,
  isReadyToSubmit,
  type Canvas,
  type ColumnLabels,
} from './lib';
import { HeaderStep } from './HeaderStep';
import { ColumnStep } from './ColumnStep';
import { PreviewSection } from './PreviewSection';
import { StepNavigation } from './StepNavigation';

interface Props {
  needsTemplate: PdfImportNeedsTemplate;
  onClose: () => void;
  onImported: (r: PdfImportImported) => void;
}

export function PdfTemplateBuilder({ needsTemplate, onClose, onImported }: Props): JSX.Element {
  const { t } = useTranslation(['pdf-template', 'imports', 'common']);
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
  // page; the user un-ticks pages that belong to a different account.
  const allPageIndices = needsTemplate.pages.map((p) => p.pageIndex);
  const [selectedPages, setSelectedPages] = useState<number[]>(allPageIndices);
  // Optional manual override for the anchor derivation. When null / empty
  // the backend runs its usual heuristics; when set, these are sent verbatim.
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
      setOcrError(t('ocrProgress.loadError'));
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
  // Guards against a stale in-flight preview response landing after the zones
  // have changed (and thus the reset effect below already ran). Every call
  // to handlePreview claims a new id; any setState it performs is only
  // applied if its id is still the current one when the response arrives.
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
  // drawing a valid rectangle. Only fires on the column steps (date,
  // description) where painting is the sole action — the header/table steps
  // have secondary controls the user needs to interact with.
  const onDateChange = (r: PageRect) => {
    setDateCol(r);
    if (step === 'date') goTo('description');
  };
  const onDescChange = (r: PageRect) => {
    setDescCol(r);
    if (step === 'description') goTo('amount');
  };

  const isLast = step === 'amount';

  const amountState = { amountMode, signedCol, debitCol, creditCol };
  const rectState = { tableRect, dateCol, descCol, ...amountState };
  const canSubmit = isReadyToSubmit(rectState, label);

  const zonesInput = {
    headerRect,
    tableRect,
    tableRepeats,
    selectedPages,
    pickedAnchor,
    pickedOtherAnchors,
    dateCol,
    descCol,
    ...amountState,
  };

  async function handlePreview() {
    const zones = buildZones(zonesInput);
    if (!zones) return;
    const myReqId = ++previewReqIdRef.current;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const r = await previewZones(needsTemplate.draftId, zones);
      if (myReqId !== previewReqIdRef.current) return;
      setPreviewRows(r.rows);
      setPreviewSkipped(r.skippedRows);
    } catch (e: any) {
      if (myReqId !== previewReqIdRef.current) return;
      setPreviewError(e ? errorMessage(e, t) : t('errors.previewFailed'));
      setPreviewRows(null);
      setPreviewSkipped([]);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleSubmit(overrideRows?: Array<{ date: string; label: string; amount: string }>) {
    const zones = buildZones(zonesInput);
    if (!zones || !label.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      const result = await submitZones(needsTemplate.draftId, label.trim(), zones, overrideRows);
      onImported(result);
    } catch (e: any) {
      setErr(e ? errorMessage(e, t) : t('errors.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  // OCR path: send the user's hand-fixed rows verbatim instead of letting the
  // backend re-parse the zones (see override_rows on POST /api/imports/pdf/templates).
  function handleOcrImport() {
    return handleSubmit(editableRows.map((r) => ({ date: r.date, label: r.label, amount: r.amount })));
  }

  const columnLabels: ColumnLabels = {
    table: t('columns.table'),
    date: t('columns.date'),
    description: t('columns.description'),
    amount: t('columns.amount'),
    debit: t('columns.debit'),
    credit: t('columns.credit'),
  };
  const refsFor = (current: Canvas) =>
    buildReferenceRects(
      { tableRect, dateCol, descCol, amountMode, signedCol, debitCol, creditCol },
      columnLabels,
      current,
    );

  const nextDisabled =
    (step === 'table' && (!tableRect || selectedPages.length === 0)) ||
    (step === 'date' && !dateCol) ||
    (step === 'description' && !descCol);

  const showsPreview = step === 'amount';

  return (
    <div className="fixed inset-0 bg-ink-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div
        className="bg-ink-900 border border-ink-700 rounded-xl shadow-card max-w-5xl w-full max-h-[92vh] overflow-auto p-6 text-ink-100"
        style={{ backgroundColor: '#11141a', color: '#e6e8ed' }}
      >
        <div className="flex justify-between items-start mb-1">
          <h2 className="display text-xl text-ink-50" style={{ color: '#f4f5f8' }}>
            {t('modal.title')}
          </h2>
          <button
            onClick={onClose}
            className="text-ink-300 hover:text-ink-50 transition text-lg leading-none px-2"
            aria-label={t('modal.close')}
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
                {t('ocrProgress.retryHint')}
              </p>
            )}
          </>
        ) : (
        <>
        <StepIndicator currentStep={step} />

        {needsTemplate.reason === 'template_stale' && (
          <div className="bg-clay-900/30 border border-clay-800/60 text-clay-200 p-3 rounded-lg mb-4 text-sm">
            <div className="font-medium mb-1">{t('staleBanner.title')}</div>
            <div className="text-clay-300/90 text-xs leading-relaxed">
              {needsTemplate.staleDiagnostic ?? t('staleBanner.fallbackDiagnostic')}
            </div>
            <div className="text-clay-300/70 text-xs mt-2">
              {t('staleBanner.replaceNote', { importLabel: t('preview.importButton') })}
            </div>
          </div>
        )}

        {step === 'header' && (
          <HeaderStep
            pngBase64={firstPage.pngBase64}
            widthPt={firstPage.widthPt}
            heightPt={firstPage.heightPt}
            headerRect={headerRect}
            onHeaderChange={setHeaderRect}
            totalSteps={totalSteps}
          />
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
          <ColumnStep
            pngBase64={firstPage.pngBase64}
            widthPt={firstPage.widthPt}
            heightPt={firstPage.heightPt}
            initialRect={dateCol}
            referenceRects={refsFor('date')}
            paintColor={PAINT_COLOR.date}
            paintLabel={t('columns.date')}
            onChange={onDateChange}
            promptI18nKey="dateStep.prompt"
            tooltipI18nKey="steps.date.tooltip"
            totalSteps={totalSteps}
          />
        )}

        {step === 'description' && (
          <ColumnStep
            pngBase64={firstPage.pngBase64}
            widthPt={firstPage.widthPt}
            heightPt={firstPage.heightPt}
            initialRect={descCol}
            referenceRects={refsFor('description')}
            paintColor={PAINT_COLOR.description}
            paintLabel={t('columns.description')}
            onChange={onDescChange}
            promptI18nKey="descriptionStep.prompt"
            tooltipI18nKey="steps.description.tooltip"
            totalSteps={totalSteps}
          />
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

        {showsPreview && (
          <PreviewSection
            canSubmit={canSubmit}
            previewLoading={previewLoading}
            previewError={previewError}
            previewRows={previewRows}
            previewSkipped={previewSkipped}
            isOcrSource={isOcrSource}
            editableRows={editableRows}
            submitting={submitting}
            onPreview={handlePreview}
            onEditableRowChange={(i, patch) =>
              setEditableRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
            }
            onEditableRowDelete={(i) =>
              setEditableRows((rows) => rows.filter((_, idx) => idx !== i))
            }
            onOcrImport={handleOcrImport}
          />
        )}

        <StepNavigation
          stepIdx={stepIdx}
          isLast={isLast}
          showSubmitButton={isLast && !isOcrSource}
          canSubmit={canSubmit}
          submitting={submitting}
          nextDisabled={nextDisabled}
          onPrev={prev}
          onNext={next}
          onSubmit={() => handleSubmit()}
        />
        </>
        )}
      </div>
    </div>
  );
}
