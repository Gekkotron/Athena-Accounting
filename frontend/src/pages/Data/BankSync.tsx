import { useAccounts } from '../../lib/useReferenceData';
import { SettingsBankSync } from '../SettingsBankSync';

// Données → Synchronisation bancaire tab. The panel itself lives in
// SettingsBankSync.tsx (it debuted on Réglages before moving here).
export function BankSync() {
  const accountsQ = useAccounts();

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Synchronisation bancaire</h1>
        </div>
      </div>
      <div className="surface p-6">
        <SettingsBankSync accounts={accountsQ.data ?? []} />
      </div>
    </>
  );
}
