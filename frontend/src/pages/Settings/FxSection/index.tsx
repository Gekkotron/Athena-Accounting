import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../../api/client';
import type { Account } from '../../../api/types';
import { useSettings } from '../../../lib/useSettings';
import { DisplayCurrencyPicker } from './DisplayCurrencyPicker';
import { RatesTable, type FxRateWire } from './RatesTable';
import { AddRateForm, type AddRateFormValues } from './AddRateForm';
import { SuggestionsStrip } from './SuggestionsStrip';

// Base currencies always offered even before any account uses them, per the
// design doc, unioned with whatever currencies the user's accounts are
// actually denominated in.
const BASE_CURRENCIES = ['EUR', 'USD', 'GBP'];

function currencyUnion(accounts: Account[]): string[] {
  const set = new Set<string>(BASE_CURRENCIES);
  for (const a of accounts) set.add(a.currency);
  return Array.from(set).sort();
}

export function FxSection(): JSX.Element {
  const { t } = useTranslation('settings');
  const qc = useQueryClient();

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const accounts = accountsQ.data?.accounts ?? [];
  const currencies = useMemo(() => currencyUnion(accounts), [accounts]);

  const ratesQ = useQuery({
    queryKey: ['fx-rates'],
    queryFn: () => api<{ rates: FxRateWire[] }>('/api/fx-rates'),
  });
  const rates = ratesQ.data?.rates ?? [];

  const { settings, patch: patchSettings } = useSettings();

  const [formError, setFormError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<{ from: string; to: string } | null>(null);

  const invalidateRates = () => qc.invalidateQueries({ queryKey: ['fx-rates'] });

  const createMut = useMutation({
    mutationFn: (values: AddRateFormValues) =>
      api<{ rate: FxRateWire }>('/api/fx-rates', { method: 'POST', json: values }),
    onSuccess: () => {
      setFormError(null);
      invalidateRates();
    },
    onError: (err: unknown) => {
      setFormError(err instanceof ApiError && err.status === 409 ? 'duplicate' : 'error');
    },
  });

  const updateMut = useMutation({
    mutationFn: (input: { id: number; rate: string; effectiveFrom: string }) =>
      api<{ rate: FxRateWire }>(`/api/fx-rates/${input.id}`, {
        method: 'PATCH',
        json: { rate: input.rate, effectiveFrom: input.effectiveFrom },
      }),
    onSuccess: invalidateRates,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api<null>(`/api/fx-rates/${id}`, { method: 'DELETE' }),
    onSuccess: invalidateRates,
  });

  const accountCurrencies = useMemo(
    () => Array.from(new Set(accounts.map((a) => a.currency))),
    [accounts],
  );

  return (
    <section className="flex flex-col gap-4 pt-4 border-t border-ink-800/60">
      <div>
        <div className="label">{t('settings.fx.title')}</div>
        <p className="text-sm text-ink-400 mt-1">{t('settings.fx.description')}</p>
      </div>

      <DisplayCurrencyPicker
        currencies={currencies}
        value={settings.displayCurrency}
        onChange={(value) => patchSettings({ displayCurrency: value })}
      />

      {settings.displayCurrency && (
        <SuggestionsStrip
          accountCurrencies={accountCurrencies}
          rates={rates}
          displayCurrency={settings.displayCurrency}
          onAdd={(from, to) => setPrefill({ from, to })}
        />
      )}

      <div>
        <div className="label mb-2">{t('settings.fx.rates.title')}</div>
        <RatesTable
          rates={rates}
          onDelete={(id) => deleteMut.mutate(id)}
          onEdit={(input) => updateMut.mutate(input)}
        />
      </div>

      <AddRateForm
        key={prefill ? `${prefill.from}-${prefill.to}` : 'default'}
        currencies={currencies}
        onSubmit={(values) => createMut.mutate(values)}
        error={formError}
        initialFrom={prefill?.from}
        initialTo={prefill?.to}
      />
    </section>
  );
}
