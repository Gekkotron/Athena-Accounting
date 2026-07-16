import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Account } from '../api/types';
import { useSettings } from '../lib/useSettings';
import { DEFAULTS, type Settings as SettingsShape } from '../lib/settings';
import { RangePicker, type RangeKey } from '../components/RangePicker';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { getMcpSettings, setMcpEnabled, generateMcpToken, revokeMcpToken } from '../api/mcp';
import { useTips } from '../contexts/TipsContext';

export function Settings(): JSX.Element {
  const { settings, isReady, patch, mutation } = useSettings();
  const { reset: resetTips } = useTips();
  const [confirmReset, setConfirmReset] = useState(false);
  // "Enregistré" flash next to the field that just accepted a PATCH.
  const [flashKey, setFlashKey] = useState<keyof SettingsShape | null>(null);
  useEffect(() => {
    if (mutation.isSuccess) {
      const t = setTimeout(() => setFlashKey(null), 1500);
      return () => clearTimeout(t);
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
        <div data-testid="settings-skeleton" className="surface p-6 h-64 animate-pulse rounded-lg bg-ink-900" />
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
        <h1 className="display text-2xl text-ink-50">Réglages</h1>
        <p className="text-sm text-ink-400 mt-1">
          Valeurs par défaut appliquées à chaque chargement du tableau de bord et aux outils d'imports.
        </p>
      </div>

      {mutation.isError && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
          Impossible d'enregistrer les réglages. Réessayez.
        </div>
      )}

      <div className="surface p-6 flex flex-col gap-6">
        <section className="flex flex-col gap-4">
          <div className="label">Tableau de bord</div>

          <div>
            <div className="text-sm mb-2 flex items-center gap-2">
              Période par défaut
              {flashKey === 'dashboardRange' && <SavedChip />}
            </div>
            <RangePicker
              value={settings.dashboardRange as RangeKey}
              onChange={(r) => send('dashboardRange', r)}
              ariaLabel="Période par défaut"
            />
          </div>

          <div>
            <label className="text-sm mb-2 block">
              Compte du graphique par défaut
              {flashKey === 'dashboardChartScope' && <SavedChip />}
            </label>
            <select
              className="input"
              value={settings.dashboardChartScope === 'all' ? 'all' : String(settings.dashboardChartScope)}
              onChange={(e) =>
                send('dashboardChartScope', e.target.value === 'all' ? 'all' : Number(e.target.value))
              }
            >
              <option value="all">Tous les comptes</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </select>
          </div>

          <NumberField
            label="Seuil de ligne pointillée (jours)"
            help="Un écart supérieur à X jours entre deux points est tracé en pointillés."
            min={1}
            max={60}
            value={settings.chartGapThresholdDays}
            onCommit={(v) => send('chartGapThresholdDays', v)}
            flashing={flashKey === 'chartGapThresholdDays'}
          />
        </section>

        <section className="flex flex-col gap-4 pt-4 border-t border-ink-800/60">
          <div className="label">Imports</div>
          <NumberField
            label="Seuil de similarité par défaut (Possibles doublons)"
            help="Filtre les groupes de doublons dont la similarité de libellés est inférieure au seuil."
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
            <div className="label">Accès MCP</div>
            <p className="text-sm text-ink-400 mt-1">
              Permet à un assistant local (Ollama via un client MCP) de gérer vos transactions.
              Le contenu est chiffré avec le jeton — rien ne circule en clair.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-200">
            <input
              data-testid="mcp-enable"
              type="checkbox"
              checked={mcp.enabled}
              onChange={(e) => void toggleMcp(e.target.checked)}
            />
            Activer l'accès MCP
          </label>
          <div className="flex items-center gap-3">
            <button
              data-testid="mcp-generate"
              type="button"
              className="btn-primary"
              onClick={() => void genToken()}
            >
              {mcp.hasToken ? 'Régénérer le jeton' : 'Générer un jeton'}
            </button>
            {mcp.hasToken && (
              <button type="button" className="btn-ghost" onClick={() => void revokeToken()}>
                Révoquer
              </button>
            )}
          </div>
          {freshToken && (
            <div className="rounded-md bg-ink-900 p-3 text-sm">
              <p className="text-amber-400 mb-1">Ce jeton ne sera plus affiché — copiez-le maintenant.</p>
              <code data-testid="mcp-token" className="break-all text-ink-100">{freshToken}</code>
              <p className="text-ink-400 mt-2">
                Configurez le client MCP avec <code>ATHENA_MCP_USER</code> (votre identifiant) et
                <code> ATHENA_MCP_TOKEN</code>.
              </p>
            </div>
          )}
        </section>

        <section className="pt-4 border-t border-ink-800/60">
          <button className="btn-ghost" onClick={() => setConfirmReset(true)}>
            Réinitialiser aux valeurs par défaut
          </button>
        </section>

        <section className="pt-4 border-t border-ink-800/60">
          <div className="label">Aide</div>
          <p className="text-sm text-ink-400 mt-1 mb-3">
            Réaffiche la visite guidée et tous les conseils de section masqués.
          </p>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              if (window.confirm('Réafficher tous les conseils de première visite ?')) {
                resetTips().catch(() => {});
              }
            }}
          >
            Rejouer la visite guidée
          </button>
        </section>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Réinitialiser les réglages ?"
        description="Tous vos réglages retrouveront leurs valeurs par défaut. Cette action ne peut pas être annulée."
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
  return (
    <span className="text-[10px] uppercase tracking-wide text-sage-300 ml-2">Enregistré</span>
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
