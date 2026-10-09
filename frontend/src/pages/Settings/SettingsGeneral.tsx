import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../lib/useSettings';
import { DEFAULTS } from '../../lib/settings';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useTips } from '../../contexts/TipsContext';
import { SectionRule } from '../../components/SectionRule';
import { SettingsSkeleton } from './_shared';

export function SettingsGeneral(): JSX.Element {
  const { t } = useTranslation('settings');
  const { isReady, patch } = useSettings();
  const { reset: resetTips } = useTips();
  const [confirmReset, setConfirmReset] = useState(false);

  if (!isReady) return <SettingsSkeleton />;

  return (
    <div className="max-w-xl flex flex-col gap-6">
      <p className="text-sm text-ink-400">
        {t('settings.page.subtitle')}
      </p>

      <div className="surface p-6 flex flex-col gap-6">
        <section>
          <button className="btn-ghost" onClick={() => setConfirmReset(true)}>
            {t('settings.reset.button')}
          </button>
        </section>

        <section className="flex flex-col gap-3">
          <SectionRule>{t('settings.help.sectionLabel')}</SectionRule>
          <p className="text-sm text-ink-400">
            {t('settings.help.description')}
          </p>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              if (window.confirm(t('settings.help.replayConfirm'))) {
                resetTips().catch(() => {});
              }
            }}
          >
            {t('settings.help.replayButton')}
          </button>
        </section>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title={t('settings.reset.dialogTitle')}
        description={t('settings.reset.dialogDescription')}
        onConfirm={() => {
          patch(DEFAULTS);
          setConfirmReset(false);
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}
