import { SettingsSecurity } from '../SettingsSecurity';
import { SettingsLock } from '../SettingsLock';

export function SettingsSecurityPage(): JSX.Element {
  return (
    <div className="max-w-xl">
      <div className="surface p-6 flex flex-col gap-6">
        <SettingsSecurity />
        <SettingsLock />
      </div>
    </div>
  );
}
