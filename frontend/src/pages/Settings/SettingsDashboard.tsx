import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RangePicker, type RangeKey } from '../../components/RangePicker';
import { SectionRule } from '../../components/SectionRule';
import { NumberField, SelectField, SavedChip, type SelectOption } from '../Settings-fields';
import { useSettingsFlash } from './useSettingsFlash';
import { useAccounts, EMPTY_ACCOUNTS } from '../../lib/useReferenceData';
import { SettingsSkeleton, SaveErrorBanner } from './_shared';
import { DASHBOARD_SECTION_IDS, type DashboardSectionId } from '../../lib/settings';

export function SettingsDashboard(): JSX.Element {
  const { t } = useTranslation('settings');
  const { settings, isReady, flashKey, send, mutation } = useSettingsFlash();

  const accountsQ = useAccounts();
  const accounts = accountsQ.data ?? EMPTY_ACCOUNTS;

  const chartScopeOptions = useMemo<SelectOption[]>(() => [
    { value: 'all', label: t('settings.dashboardSection.allAccountsOption') },
    ...accounts.map((a) => ({ value: String(a.id), label: `${a.name} (${a.currency})` })),
  ], [accounts, t]);

  if (!isReady) return <SettingsSkeleton />;

  return (
    <div className="max-w-xl flex flex-col gap-6">
      <p className="text-sm text-ink-400">{t('settings.dashboardSection.subtitle')}</p>

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

        <SelectField
          label={t('settings.dashboardSection.defaultChartScopeLabel')}
          value={settings.dashboardChartScope === 'all' ? 'all' : String(settings.dashboardChartScope)}
          options={chartScopeOptions}
          flashing={flashKey === 'dashboardChartScope'}
          onChange={(v) => send('dashboardChartScope', v === 'all' ? 'all' : Number(v))}
        />

        <NumberField
          label={t('settings.dashboardSection.gapThreshold.label')}
          help={t('settings.dashboardSection.gapThreshold.help')}
          min={1}
          max={60}
          value={settings.chartGapThresholdDays}
          onCommit={(v) => send('chartGapThresholdDays', v)}
          flashing={flashKey === 'chartGapThresholdDays'}
        />

        <div>
          <div className="text-sm mb-1 flex items-center gap-2">
            {t('settings.dashboardSection.visibleSections.label')}
            {flashKey === 'dashboardHiddenSections' && <SavedChip />}
          </div>
          <p className="text-xs text-ink-500 mb-2">
            {t('settings.dashboardSection.visibleSections.help')}
          </p>
          <ul className="flex flex-col gap-1.5">
            {DASHBOARD_SECTION_IDS.map((id) => {
              const hidden = settings.dashboardHiddenSections.includes(id);
              return (
                <li key={id}>
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="accent-sage-500"
                      checked={!hidden}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? settings.dashboardHiddenSections.filter((s) => s !== id)
                          : [...settings.dashboardHiddenSections, id as DashboardSectionId];
                        send('dashboardHiddenSections', next);
                      }}
                    />
                    {t(`settings.dashboardSection.visibleSections.items.${id}`)}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
