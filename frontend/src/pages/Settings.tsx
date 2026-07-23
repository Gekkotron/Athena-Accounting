import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation, Trans } from 'react-i18next';
import { api } from '../api/client';
import type { Account } from '../api/types';
import { useSettings } from '../lib/useSettings';
import { DEFAULTS, type Settings as SettingsShape } from '../lib/settings';
import { RangePicker, type RangeKey } from '../components/RangePicker';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { getMcpSettings, setMcpEnabled, generateMcpToken, revokeMcpToken } from '../api/mcp';
import { useTips } from '../contexts/TipsContext';
import { LoadingBlock } from '../components/StateBlocks';

export function Settings(): JSX.Element {
  const { t } = useTranslation('settings');
  const { settings, isReady, patch, mutation } = useSettings();
  const { reset: resetTips } = useTips();
  const [confirmReset, setConfirmReset] = useState(false);
  // "Enregistré" flash next to the field that just accepted a PATCH.
  const [flashKey, setFlashKey] = useState<keyof SettingsShape | null>(null);
  useEffect(() => {
    if (mutation.isSuccess) {
      const timer = setTimeout(() => setFlashKey(null), 1500);
      return () => clearTimeout(timer);
    }
    if (mutation.isError) {
      setFlashKey(null);
    }
  }, [mutation.isSuccess, mutation.isError, mutation.data]);

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const accounts = accountsQ.data?.accounts ?? [];

  const qc = useQueryClient();
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const mcpQ = useQuery({ queryKey: ['mcp-settings'], queryFn: getMcpSettings });
  const mcp = mcpQ.data ?? { enabled: false, hasToken: false };

  const toggleMcp = async (enabled: boolean) => {
    await setMcpEnabled(enabled);
    qc.invalidateQueries({ queryKey: ['mcp-settings'] });
  };
  const genToken = async () => {
    const { token } = await generateMcpToken();
    setFreshToken(token);
    qc.invalidateQueries({ queryKey: ['mcp-settings'] });
  };
  const revokeToken = async () => {
    await revokeMcpToken();
    setFreshToken(null);
    qc.invalidateQueries({ queryKey: ['mcp-settings'] });
  };

  if (!isReady) {
    return (
      <div className="max-w-xl">
        <div data-testid="settings-skeleton">
          <LoadingBlock height="min-h-64" />
        </div>
      </div>
    );
  }

  const send = <K extends keyof SettingsShape>(key: K, value: SettingsShape[K]) => {
    if (settings[key] === value) return;
    setFlashKey(key);
    patch({ [key]: value } as Partial<SettingsShape>);
  };

  return (
    <div className="max-w-xl flex flex-col gap-6">
      <div>
        <h1 className="display text-2xl text-ink-50">{t('settings.page.title')}</h1>
        <p className="text-sm text-ink-400 mt-1">
          {t('settings.page.subtitle')}
        </p>
      </div>

      {mutation.isError && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
          {t('settings.errors.saveFailed')}
        </div>
      )}

      <div className="surface p-6 flex flex-col gap-6">
        <section className="flex flex-col gap-4">
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
        </section>

        <section className="flex flex-col gap-4 pt-4 border-t border-ink-800/60">
          <div className="label">{t('settings.transactionsSection.label')}</div>

          <div>
            <label className="text-sm mb-2 block">
              {t('settings.transactionsSection.defaultAccountLabel')}
              {flashKey === 'transactionsDefaultAccount' && <SavedChip />}
            </label>
            <select
              className="input"
              aria-label={t('settings.transactionsSection.defaultAccountLabel')}
              value={
                settings.transactionsDefaultAccount === 'first-checking'
                  ? 'first-checking'
                  : settings.transactionsDefaultAccount === 'all'
                    ? 'all'
                    : String(settings.transactionsDefaultAccount)
              }
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'first-checking' || v === 'all') {
                  send('transactionsDefaultAccount', v);
                } else {
                  send('transactionsDefaultAccount', Number(v));
                }
              }}
            >
              <option value="first-checking">{t('settings.transactionsSection.firstCheckingOption')}</option>
              <option value="all">{t('settings.transactionsSection.allAccountsOption')}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="flex flex-col gap-4 pt-4 border-t border-ink-800/60">
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
        </section>

        <section data-testid="mcp-section" className="flex flex-col gap-4 pt-4 border-t border-ink-800/60">
          <div>
            <div className="label">{t('settings.mcp.sectionLabel')}</div>
            <p className="text-sm text-ink-400 mt-1">
              {t('settings.mcp.description')}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-200">
            <input
              data-testid="mcp-enable"
              type="checkbox"
              checked={mcp.enabled}
              onChange={(e) => void toggleMcp(e.target.checked)}
            />
            {t('settings.mcp.enableLabel')}
          </label>
          <div className="flex items-center gap-3">
            <button
              data-testid="mcp-generate"
              type="button"
              className="btn-primary"
              onClick={() => void genToken()}
            >
              {mcp.hasToken ? t('settings.mcp.regenerateButton') : t('settings.mcp.generateButton')}
            </button>
            {mcp.hasToken && (
              <button type="button" className="btn-ghost" onClick={() => void revokeToken()}>
                {t('settings.mcp.revokeButton')}
              </button>
            )}
          </div>
          {freshToken && (
            <div className="rounded-md bg-ink-900 p-3 text-sm">
              <p className="text-amber-400 mb-1">{t('settings.mcp.tokenWarning')}</p>
              <code data-testid="mcp-token" className="break-all text-ink-100">{freshToken}</code>
              <p className="text-ink-400 mt-2">
                <Trans i18nKey="settings:settings.mcp.tokenConfigHint">
                  Configurez le client MCP avec <code>ATHENA_MCP_USER</code> (votre identifiant) et
                  <code> ATHENA_MCP_TOKEN</code>.
                </Trans>
              </p>
            </div>
          )}
        </section>

        <section className="pt-4 border-t border-ink-800/60">
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

function SavedChip() {
  const { t } = useTranslation('settings');
  return (
    <span className="text-[10px] uppercase tracking-wide text-sage-300 ml-2">{t('settings.savedChip')}</span>
  );
}

// Blur-committed integer input. Local state so keystrokes don't PATCH.
function NumberField(props: {
  label: string;
  help: string;
  min: number;
  max: number;
  value: number;
  suffix?: string;
  flashing: boolean;
  onCommit: (v: number) => void;
}) {
  const { label, help, min, max, value, suffix, flashing, onCommit } = props;
  const [local, setLocal] = useState<string>(String(value));
  const initial = useRef(value);
  useEffect(() => {
    // Re-sync when the server value changes underneath us (invalidate/refetch).
    if (value !== initial.current) {
      setLocal(String(value));
      initial.current = value;
    }
  }, [value]);

  const commit = () => {
    const n = Number.parseInt(local, 10);
    if (!Number.isFinite(n) || n < min || n > max || n === value) {
      setLocal(String(value));
      return;
    }
    onCommit(n);
  };

  return (
    <div>
      <label className="text-sm mb-1 block">
        {label}
        {flashing && <SavedChip />}
      </label>
      <div className="flex items-center gap-2">
        <input
          inputMode="numeric"
          className="input w-28"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          aria-label={label}
        />
        {suffix && <span className="text-sm text-ink-400">{suffix}</span>}
      </div>
      <p className="text-xs text-ink-500 mt-1">{help}</p>
    </div>
  );
}
