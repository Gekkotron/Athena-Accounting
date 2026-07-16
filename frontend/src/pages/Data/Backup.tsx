import { BackupPanel } from '../Imports/BackupPanel';
import { SectionTip } from '../../components/SectionTip';
import { SectionTipHelpIcon } from '../../components/SectionTipHelpIcon';

export function Backup() {
  return (
    <>
      <div className="page-header">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="page-title">Sauvegarde</h1>
            <SectionTipHelpIcon id="section:data" />
          </div>
        </div>
      </div>
      <SectionTip id="section:data" />
      <BackupPanel />
    </>
  );
}
