import { DuplicatesPanel } from '../Imports/DuplicatesPanel';
import { useAutoStartTour } from '../../hooks/useAutoStartTour';
import { useTourAnchor } from '../../hooks/useTourAnchor';
import { TourReplayIcon } from '../../components/TourReplayIcon';

export function Duplicates() {
  useAutoStartTour('data-duplicates');
  const listAnchor = useTourAnchor('data-duplicates:list');
  const actionAnchor = useTourAnchor('data-duplicates:action');

  return (
    <div className="relative">
      <span ref={listAnchor} aria-hidden className="pointer-events-none absolute right-4 top-4 h-1 w-1" />
      <span ref={actionAnchor} aria-hidden className="pointer-events-none absolute right-16 top-4 h-1 w-1" />
      <div className="flex justify-end mb-2">
        <TourReplayIcon pageId="data-duplicates" />
      </div>
      <DuplicatesPanel />
    </div>
  );
}
