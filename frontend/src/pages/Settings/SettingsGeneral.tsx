import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../lib/useSettings';
import { DEFAULTS } from '../../lib/settings';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useTips } from '../../contexts/TipsContext';
import { LoadingBlock } from '../../components/StateBlocks';

export function SettingsGeneral(): JSX.Element {
  const { t } = useTranslation('settings');
  const { isReady, patch } = useSettings();
  const { reset: resetTips } = useTips();
  const [confirmReset, setConfirmReset] = useState(false);

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
      <p className="text-sm text-ink-400">
        {t('settings.page.subtitle')}
      </p>

      <div className="surface p-6 flex flex-col gap-6">
        <section>
          <button className="btn-ghost" onClick={() => setConfirmReset(true)}>
            {t('settings.reset.button')}
          </button>
        </section>

        <section className="pt-4 border-t border-ink-800/60">
          <div className="label">{t('settings.help.sectionLabel')}</div>
          <p className="text-sm text-ink-400 mt-1 mb-3">
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
