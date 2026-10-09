import { useTranslation } from 'react-i18next';
import { FxSection } from './FxSection';

export function SettingsFx(): JSX.Element {
  const { t } = useTranslation('settings');
  return (
    <div className="max-w-xl flex flex-col gap-6">
      <p className="text-sm text-ink-400">{t('settings.fx.description')}</p>
      <div className="surface p-6">
        <FxSection />
      </div>
    </div>
  );
}
