import { useTranslation } from 'react-i18next';
import { LoadingBlock } from '../../components/StateBlocks';
import { NumberField } from '../Settings-fields';
import { useSettingsFlash } from './useSettingsFlash';

export function SettingsImport(): JSX.Element {
  const { t } = useTranslation('settings');
  const { settings, isReady, flashKey, send, mutation } = useSettingsFlash();

  if (!isReady) {
    return (
      <div className="max-w-xl">
        <div data-testid="settings-skeleton">
          <LoadingBlock height="min-h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl flex flex-col gap-6">
      {mutation.isError && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
          {t('settings.errors.saveFailed')}
        </div>
      )}

      <div className="surface p-6 flex flex-col gap-4">
        <div className="label">{t('settings.importsSection.label')}</div>
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
