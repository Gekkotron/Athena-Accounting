import { useTranslation } from 'react-i18next';
import { RangePicker, type RangeKey } from '../../components/RangePicker';
import { SectionRule } from '../../components/SectionRule';
import { NumberField, SavedChip } from '../Settings-fields';
import { useSettingsFlash } from './useSettingsFlash';
import { useAccounts } from '../../lib/useReferenceData';
import { SettingsSkeleton, SaveErrorBanner } from './_shared';

export function SettingsDashboard(): JSX.Element {
  const { t } = useTranslation('settings');
  const { settings, isReady, flashKey, send, mutation } = useSettingsFlash();

  const accountsQ = useAccounts();
  const accounts = accountsQ.data ?? [];

  if (!isReady) return <SettingsSkeleton />;

  return (
    <div className="max-w-xl flex flex-col gap-6">
      {mutation.isError && <SaveErrorBanner message={t('settings.errors.saveFailed')} />}

      <div className="surface p-6 flex flex-col gap-4">
        <SectionRule>{t('settings.dashboardSection.label')}</SectionRule>

        <div>
          <div className="text-sm mb-2 flex items-center gap-2">
            {t('settings.dashboardSection.defaultRangeLabel')}
            {flashKey === 'dashboardRange' && <SavedChip />}
          </div>
          <RangePicker
            value={settings.dashboardRange as RangeKey}
            onChange={(r) => send('dashboardRange', r)}
            ariaLabel={t('settings.dashboardSection.defaultRangeLabel')}
          />
        </div>

        <div>
          <label className="text-sm mb-2 block">
            {t('settings.dashboardSection.defaultChartScopeLabel')}
            {flashKey === 'dashboardChartScope' && <SavedChip />}
          </label>
          <select
            className="input"
            value={settings.dashboardChartScope === 'all' ? 'all' : String(settings.dashboardChartScope)}
            onChange={(e) =>
              send('dashboardChartScope', e.target.value === 'all' ? 'all' : Number(e.target.value))
            }
          >
            <option value="all">{t('settings.dashboardSection.allAccountsOption')}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </div>

        <NumberField
          label={t('settings.dashboardSection.gapThreshold.label')}
          help={t('settings.dashboardSection.gapThreshold.help')}
          min={1}
          max={60}
          value={settings.chartGapThresholdDays}
          onCommit={(v) => send('chartGapThresholdDays', v)}
          flashing={flashKey === 'chartGapThresholdDays'}
        />
      </div>
    </div>
  );
}
