import { useTranslation } from 'react-i18next';
import type { Account } from '../../api/types';
import { AccountSelect } from './AccountSelect';
import { RangePicker, type RangeKey } from '../../components/RangePicker';

interface Props {
  value: 'all' | 'available' | number;
  onValueChange: (v: 'all' | 'available' | number) => void;
  accounts: Account[];
  primaryCurrency: string | undefined;
  hideAvailable: boolean;
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
}

// Single page-wide scope bar for the Dashboard's chart group (Evolution,
// Category donut, Sankey). The three sections share the same range + account
// state via useDashboardScope — before this bar the pair of controls was
// repeated in each section header, so the user saw three identical pickers
// as they scrolled. The forecast toggle stays with the Evolution section
// because it only affects that chart.
export function ChartScopeBar({
  value, onValueChange, accounts, primaryCurrency, hideAvailable, range, onRangeChange,
}: Props): JSX.Element {
  const { t } = useTranslation('dashboard');
  return (
    <div
      role="group"
      aria-label={t('scope.ariaLabel')}
      className="surface-soft flex items-center justify-end gap-2 flex-wrap px-3 py-2"
    >
      <AccountSelect
        value={value}
        onChange={onValueChange}
        accounts={accounts}
        primaryCurrency={primaryCurrency}
        hideAvailable={hideAvailable}
      />
      <RangePicker value={range} onChange={onRangeChange} />
    </div>
  );
}
