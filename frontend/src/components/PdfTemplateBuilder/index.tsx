import { useTranslation } from 'react-i18next';
import { type PdfImportNeedsTemplate, type PdfImportImported } from '../../api/pdf-templates.js';
import { StepIndicator } from './StepIndicator';
import { TableStep } from './TableStep';
import { AmountStep } from './AmountStep';
import { OcrProgress } from './OcrProgress';
import { PAINT_COLOR } from './constants';
import { HeaderStep } from './HeaderStep';
import { ColumnStep } from './ColumnStep';
import { PreviewSection } from './PreviewSection';
import { StepNavigation } from './StepNavigation';
import { usePdfTemplateBuilder } from './usePdfTemplateBuilder';

interface Props {
  needsTemplate: PdfImportNeedsTemplate;
  onClose: () => void;
  onImported: (r: PdfImportImported) => void;
}

export function PdfTemplateBuilder({ needsTemplate, onClose, onImported }: Props): JSX.Element {
  const { t } = useTranslation(['pdf-template', 'imports', 'common']);
  const s = usePdfTemplateBuilder(needsTemplate, onImported);

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

        {s.isOcrSource && !s.ocrReady ? (
          <>
            <OcrProgress
              draftId={needsTemplate.draftId}
              onReady={s.handleOcrReady}
              onError={s.setOcrError}
            />
            {s.ocrError && (
              <p className="text-center text-xs text-ink-500 -mt-6">
                {t('ocrProgress.retryHint')}
              </p>
            )}
          </>
        ) : (
        <>
        <StepIndicator currentStep={s.step} />

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

        {s.step === 'header' && (
          <HeaderStep
            pngBase64={s.firstPage.pngBase64}
            widthPt={s.firstPage.widthPt}
            heightPt={s.firstPage.heightPt}
            headerRect={s.headerRect}
            onHeaderChange={s.setHeaderRect}
            totalSteps={s.totalSteps}
          />
        )}

        {s.step === 'table' && (
          <TableStep
            needsTemplate={s.effectiveNeedsTemplate}
            totalSteps={s.totalSteps}
            tableRect={s.tableRect}
            onTableChange={s.setTableRect}
            tableRepeats={s.tableRepeats}
            onTableRepeatsChange={s.setTableRepeats}
            selectedPages={s.selectedPages}
            onSelectedPagesChange={s.setSelectedPages}
            pageAnchor={s.pickedAnchor}
            otherAnchors={s.pickedOtherAnchors}
            onPageAnchorChange={s.setPickedAnchor}
            onOtherAnchorsChange={s.setPickedOtherAnchors}
          />
        )}

        {s.step === 'date' && (
          <ColumnStep
            pngBase64={s.firstPage.pngBase64}
            widthPt={s.firstPage.widthPt}
            heightPt={s.firstPage.heightPt}
            initialRect={s.dateCol}
            referenceRects={s.refsFor('date')}
            paintColor={PAINT_COLOR.date}
            paintLabel={t('columns.date')}
            onChange={s.onDateChange}
            promptI18nKey="dateStep.prompt"
            tooltipI18nKey="steps.date.tooltip"
            totalSteps={s.totalSteps}
          />
        )}

        {s.step === 'description' && (
          <ColumnStep
            pngBase64={s.firstPage.pngBase64}
            widthPt={s.firstPage.widthPt}
            heightPt={s.firstPage.heightPt}
            initialRect={s.descCol}
            referenceRects={s.refsFor('description')}
            paintColor={PAINT_COLOR.description}
            paintLabel={t('columns.description')}
            onChange={s.onDescChange}
            promptI18nKey="descriptionStep.prompt"
            tooltipI18nKey="steps.description.tooltip"
            totalSteps={s.totalSteps}
          />
        )}

        {s.step === 'amount' && (
          <AmountStep
            needsTemplate={s.effectiveNeedsTemplate}
            totalSteps={s.totalSteps}
            amountMode={s.amountMode}
            onAmountModeChange={s.setAmountMode}
            signedCol={s.signedCol}
            onSignedChange={s.setSignedCol}
            debitCol={s.debitCol}
            onDebitChange={s.setDebitCol}
            creditCol={s.creditCol}
            onCreditChange={s.setCreditCol}
            refsFor={s.refsFor}
            label={s.label}
            onLabelChange={s.setLabel}
            err={s.err}
          />
        )}

        {s.showsPreview && (
          <PreviewSection
            canSubmit={s.canSubmit}
            previewLoading={s.previewLoading}
            previewError={s.previewError}
            previewRows={s.previewRows}
            previewSkipped={s.previewSkipped}
            isOcrSource={s.isOcrSource}
            editableRows={s.editableRows}
            submitting={s.submitting}
            onPreview={s.handlePreview}
            onEditableRowChange={(i, patch) =>
              s.setEditableRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
            }
            onEditableRowDelete={(i) =>
              s.setEditableRows((rows) => rows.filter((_, idx) => idx !== i))
            }
            onOcrImport={s.handleOcrImport}
          />
        )}

        <StepNavigation
          stepIdx={s.stepIdx}
          isLast={s.isLast}
          showSubmitButton={s.isLast && !s.isOcrSource}
          canSubmit={s.canSubmit}
          submitting={s.submitting}
          nextDisabled={s.nextDisabled}
          onPrev={s.prev}
          onNext={s.next}
          onSubmit={() => s.handleSubmit()}
        />
        </>
        )}
      </div>
    </div>
  );
}
