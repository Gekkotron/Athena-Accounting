import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation, Trans } from 'react-i18next';
import { getMcpSettings, setMcpEnabled, generateMcpToken, revokeMcpToken } from '../../api/mcp';
import { SettingsSecurity } from '../SettingsSecurity';
import { SettingsLock } from '../SettingsLock';

// The MCP token is an app-wide access credential, so it lives in the
// security tab next to the password + lock forms instead of a standalone
// "Integrations" tab.
function McpAccessSection(): JSX.Element {
  const { t } = useTranslation('settings');
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

  return (
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
  );
}

export function SettingsSecurityPage(): JSX.Element {
  return (
    <div className="max-w-xl">
      <div className="surface p-6 flex flex-col gap-6">
        <SettingsSecurity />
        <SettingsLock />
        <McpAccessSection />
      </div>
    </div>
  );
}
