import type { Account } from '../../api/types';
import { RangePicker, type RangeKey } from '../../components/RangePicker';
import { AccountSelect } from './AccountSelect';

// Shared account-scope + range cluster that sits in the header of both the
// evolution curve and the category donut. The two usages differ only in the
// optional forecast toggle rendered next to them, so the toggle stays in
// Dashboard/index.tsx and this component owns just the pair.
export function ScopeControls({
  value,
  onValueChange,
  accounts,
  primaryCurrency,
  hideAvailable,
  range,
  onRangeChange,
}: {
  value: 'all' | 'available' | number;
  onValueChange: (v: 'all' | 'available' | number) => void;
  accounts: Account[];
  primaryCurrency: string | undefined;
  hideAvailable: boolean;
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
}): JSX.Element {
  return (
    <>
      <AccountSelect
        value={value}
        onChange={onValueChange}
        accounts={accounts}
        primaryCurrency={primaryCurrency}
        hideAvailable={hideAvailable}
      />
      <RangePicker value={range} onChange={onRangeChange} />
    </>
  );
}
