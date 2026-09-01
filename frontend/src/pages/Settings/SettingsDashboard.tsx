import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { Account } from '../../api/types';
import { RangePicker, type RangeKey } from '../../components/RangePicker';
import { LoadingBlock } from '../../components/StateBlocks';
import { NumberField, SavedChip } from '../Settings-fields';
import { useSettingsFlash } from './useSettingsFlash';

export function SettingsDashboard(): JSX.Element {
  const { t } = useTranslation('settings');
  const { settings, isReady, flashKey, send, mutation } = useSettingsFlash();

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const accounts = accountsQ.data?.accounts ?? [];

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
        <div className="label">{t('settings.dashboardSection.label')}</div>

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
