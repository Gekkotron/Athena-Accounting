import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation, Trans } from 'react-i18next';
import { getMcpSettings, setMcpEnabled, generateMcpToken, revokeMcpToken } from '../../api/mcp';
import { SectionRule } from '../../components/SectionRule';
import { SettingsSecurity } from '../SettingsSecurity';
import { SettingsLock } from '../SettingsLock';
import { TotpSection } from './totp/TotpSection';

// The MCP token is an app-wide access credential, so it lives in the
// security tab next to the password + lock forms instead of a standalone
// "Integrations" tab.
function McpAccessSection(): JSX.Element {
  const { t } = useTranslation('settings');
  const qc = useQueryClient();
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const mcpQ = useQuery({ queryKey: ['mcp-settings'], queryFn: getMcpSettings });
  const mcp = mcpQ.data ?? { enabled: false, hasToken: false };

  const toggleMcp = async (enabled: boolean) => {
    await setMcpEnabled(enabled);
    qc.invalidateQueries({ queryKey: ['mcp-settings'] });
  };
  const genToken = async () => {
    const { token } = await generateMcpToken();
    setFreshToken(token);
    setCopied(false);
    qc.invalidateQueries({ queryKey: ['mcp-settings'] });
  };
  const revokeToken = async () => {
    await revokeMcpToken();
    setFreshToken(null);
    setCopied(false);
    qc.invalidateQueries({ queryKey: ['mcp-settings'] });
  };
  const copyToken = async () => {
    if (!freshToken) return;
    try {
      await navigator.clipboard.writeText(freshToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Silent — the token is still visible on screen.
    }
  };

  return (
    <section data-testid="mcp-section" className="flex flex-col gap-4">
      <SectionRule>{t('settings.mcp.sectionLabel')}</SectionRule>
      <p className="text-sm text-ink-400">
        {t('settings.mcp.description')}
      </p>
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
          <div className="flex items-start gap-2">
            <code
              data-testid="mcp-token"
              className="break-all text-ink-100 flex-1 min-w-0"
            >
              {freshToken}
            </code>
            <button
              type="button"
              className="btn-ghost shrink-0"
              aria-label={t('settings.mcp.tokenCopyAria')}
              onClick={() => void copyToken()}
            >
              {copied ? t('settings.mcp.tokenCopied') : t('settings.mcp.tokenCopy')}
            </button>
          </div>
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
  const { t } = useTranslation('settings');
  return (
    <div className="max-w-xl flex flex-col gap-6">
      <p className="text-sm text-ink-400">{t('settings.security.subtitle')}</p>
      <div className="surface p-6 flex flex-col gap-6">
        <SettingsSecurity />
        <SettingsLock />
        <TotpSection />
        <McpAccessSection />
      </div>
    </div>
  );
}
