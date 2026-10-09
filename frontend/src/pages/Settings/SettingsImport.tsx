import { useTranslation } from 'react-i18next';
import { SectionRule } from '../../components/SectionRule';
import { NumberField } from '../Settings-fields';
import { useSettingsFlash } from './useSettingsFlash';
import { SettingsSkeleton, SaveErrorBanner } from './_shared';

export function SettingsImport(): JSX.Element {
  const { t } = useTranslation('settings');
  const { settings, isReady, flashKey, send, mutation } = useSettingsFlash();

  if (!isReady) return <SettingsSkeleton />;

  return (
    <div className="max-w-xl flex flex-col gap-6">
      <p className="text-sm text-ink-400">{t('settings.importsSection.subtitle')}</p>

      {mutation.isError && <SaveErrorBanner message={t('settings.errors.saveFailed')} />}

      <div className="surface p-6 flex flex-col gap-4">
        <SectionRule>{t('settings.importsSection.label')}</SectionRule>
        <NumberField
          label={t('settings.importsSection.duplicateThreshold.label')}
          help={t('settings.importsSection.duplicateThreshold.help')}
          min={0}
          max={100}
          suffix="%"
          value={settings.duplicateSimilarityThreshold}
          onCommit={(v) => send('duplicateSimilarityThreshold', v)}
          flashing={flashKey === 'duplicateSimilarityThreshold'}
        />
      </div>
    </div>
  );
}
