import { PdfTemplatesPanel } from '../Imports/PdfTemplatesPanel';
import { useAutoStartTour } from '../../hooks/useAutoStartTour';
import { useTourAnchor } from '../../hooks/useTourAnchor';
import { TourReplayIcon } from '../../components/TourReplayIcon';

export function PdfTemplates() {
  useAutoStartTour('data-pdf-templates');
  const listAnchor = useTourAnchor('data-pdf-templates:list');
  const importAnchor = useTourAnchor('data-pdf-templates:import');

  return (
    <div className="relative">
      <span ref={listAnchor} aria-hidden className="pointer-events-none absolute right-4 top-4 h-1 w-1" />
      <span ref={importAnchor} aria-hidden className="pointer-events-none absolute right-16 top-4 h-1 w-1" />
      <div className="flex justify-end mb-2">
        <TourReplayIcon pageId="data-pdf-templates" />
      </div>
      <PdfTemplatesPanel />
    </div>
  );
}
