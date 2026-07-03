import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Account } from '../api/types';
import { useSettings } from '../lib/useSettings';
import { DEFAULTS, type Settings as SettingsShape } from '../lib/settings';
import { RangePicker, type RangeKey } from '../components/RangePicker';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function Settings(): JSX.Element {
  const { settings, isReady, patch, mutation } = useSettings();
  const [confirmReset, setConfirmReset] = useState(false);
  // "Enregistré" flash next to the field that just accepted a PATCH.
  const [flashKey, setFlashKey] = useState<keyof SettingsShape | 'all' | null>(null);
  useEffect(() => {
    if (!mutation.isSuccess) return;
    const t = setTimeout(() => setFlashKey(null), 1500);
    return () => clearTimeout(t);
  }, [mutation.isSuccess, mutation.data]);

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const accounts = accountsQ.data?.accounts ?? [];

  if (!isReady) {
    return (
      <div className="max-w-xl">
        <div data-testid="settings-skeleton" className="surface p-6 h-64 animate-pulse rounded-lg bg-ink-900" />
      </div>
    );
  }

  const send = <K extends keyof SettingsShape>(key: K, value: SettingsShape[K]) => {
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

        <section className="pt-4 border-t border-ink-800/60">
          <button className="btn-ghost" onClick={() => setConfirmReset(true)}>
            Réinitialiser aux valeurs par défaut
          </button>
        </section>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Réinitialiser les réglages ?"
        description="Tous vos réglages retrouveront leurs valeurs par défaut. Cette action ne peut pas être annulée."
        onConfirm={() => {
          setFlashKey('all');
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
          type="number"
          className="input w-28"
          min={min}
          max={max}
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
