import { useTranslation } from 'react-i18next';
import { STEP_ORDER, type Step } from './constants';

interface Props {
  currentStep: Step;
}

export function StepIndicator({ currentStep }: Props): JSX.Element {
  const { t } = useTranslation('pdf-template');
  const stepIdx = STEP_ORDER.indexOf(currentStep);
  return (
    <ol className="flex gap-2 mb-4 text-xs">
      {STEP_ORDER.map((s, i) => {
        const active = s === currentStep;
        const done = i < stepIdx;
        return (
          <li
            key={s}
            className={
              'px-2.5 py-1 rounded-full border transition ' +
              (active
                ? 'bg-sage-300 text-ink-950 border-sage-300 font-semibold'
                : done
                ? 'border-sage-300/60 text-sage-300'
                : 'border-ink-700 text-ink-400')
            }
          >
            {i + 1}. {t(`steps.${s}.title`)}
          </li>
        );
      })}
    </ol>
  );
}
