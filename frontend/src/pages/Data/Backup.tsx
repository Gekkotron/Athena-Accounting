import { BackupPanel } from '../Imports/BackupPanel';
import { useAutoStartTour } from '../../hooks/useAutoStartTour';
import { useTourAnchor } from '../../hooks/useTourAnchor';
import { TourReplayIcon } from '../../components/TourReplayIcon';

export function Backup() {
  useAutoStartTour('data');
  const exportAnchor = useTourAnchor('data:export');

  return (
    <>
      <div className="page-header">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="page-title">Sauvegarde</h1>
            <TourReplayIcon pageId="data" />
          </div>
        </div>
      </div>
      <div ref={exportAnchor}>
        <BackupPanel />
      </div>
    </>
  );
}
