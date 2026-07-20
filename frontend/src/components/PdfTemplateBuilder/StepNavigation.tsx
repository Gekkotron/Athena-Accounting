import { useTranslation } from 'react-i18next';

interface Props {
  stepIdx: number;
  isLast: boolean;
  showSubmitButton: boolean;
  canSubmit: boolean;
  submitting: boolean;
  nextDisabled: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSubmit: () => void;
}

export function StepNavigation({
  stepIdx,
  isLast,
  showSubmitButton,
  canSubmit,
  submitting,
  nextDisabled,
  onPrev,
  onNext,
  onSubmit,
}: Props): JSX.Element {
  const { t } = useTranslation(['pdf-template', 'common']);
  return (
    <div className="flex justify-between gap-2 mt-6">
      <button
        className="px-4 py-2 rounded-lg border border-ink-700 text-ink-200 hover:bg-ink-850 transition disabled:opacity-30 disabled:cursor-not-allowed"
        onClick={onPrev}
        disabled={stepIdx === 0}
      >← {t('previous', { ns: 'common' })}</button>

      {!isLast ? (
        <button
          className="px-4 py-2 rounded-lg bg-sage-300 text-ink-950 font-medium hover:bg-sage-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={onNext}
          disabled={nextDisabled}
        >{t('next', { ns: 'common' })} →</button>
      ) : showSubmitButton ? (
        <button
          className="px-4 py-2 rounded-lg bg-sage-300 text-ink-950 font-medium hover:bg-sage-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={onSubmit}
          disabled={!canSubmit || submitting}
        >{submitting ? t('preview.importButtonLoading') : t('preview.importButton')}</button>
      ) : null}
    </div>
  );
}
